package handlers

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// connectTimeout caps how long the HTTP /connect handler waits for
// either a QR or Connected event. Beyond this we return
// {"status":"connecting"} and let the client poll /status.
const connectTimeout = 30 * time.Second
const pairCodeReadyTimeout = 5 * time.Second

// WaLifecycle bundles the connect/disconnect/status handlers. Split
// from WaInstances (CRUD) so each file stays focused.
type WaLifecycle struct {
	q        *queries.Queries
	registry *whatsapp.Registry
}

func NewWaLifecycle(q *queries.Queries, registry *whatsapp.Registry) *WaLifecycle {
	return &WaLifecycle{q: q, registry: registry}
}

func normalizePairPhone(input string) (string, error) {
	jid, err := whatsapp.NormalizeJID(input)
	if err != nil {
		return "", err
	}
	const suffix = "@s.whatsapp.net"
	if !strings.HasSuffix(jid, suffix) {
		return "", fmt.Errorf("phone number must be a personal WhatsApp number")
	}
	return strings.TrimSuffix(jid, suffix), nil
}

// Connect POST /v1/wa/instances/:id/connect
//
// Idempotent: starts (or reuses) the in-memory Connection, then
// blocks for up to connectTimeout waiting for the first QR or
// Connected event. Returns one of:
//
//	{ "status": "connected" }
//	{ "status": "qr", "qr": "data:image/png;base64,..." }
//	{ "status": "connecting" }   // timed out — client should poll /status
//
// Tenant scope is enforced by looking up wa_instances first; cross-
// tenant requests get 404.
func (h *WaLifecycle) Connect(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Verify ownership BEFORE touching the registry — never let
	// tenant A poke tenant B's socket. Also pulls the persisted
	// status so we can purge stale sessions below.
	instance, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: id, TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	// Stale-session recovery — when the user logged out from their
	// phone (Settings → Linked Devices → Log out), whatsmeow emitted
	// LoggedOut and we persisted wa_instances.status='logged_out'.
	// The data/{id}.db SQLite store still has the revoked device row
	// though. Re-running Start() on it would re-attach with dead
	// credentials, generate no QR, and the handler would time out.
	//
	// Fix: when the persisted status is logged_out, Purge BEFORE
	// Start. Purge is no-op if no in-memory record exists (fresh api
	// restart) and tears down + deletes the SQLite store either way.
	// Start then opens a clean store, whatsmeow creates a new device,
	// QR pairing fires as if this were a brand-new instance.
	if instance.Status == whatsapp.StatusLoggedOut {
		if err := h.registry.Purge(c.UserContext(), c.Params("id")); err != nil {
			return internalError(c, fmt.Errorf("purge stale logged_out session: %w", err))
		}
	}

	conn, err := h.registry.Start(c.UserContext(), c.Params("id"))
	if err != nil {
		return internalError(c, err)
	}

	// Fast path — already connected when we arrived (e.g., revived
	// from a previous run). No event will fire so we'd time out
	// otherwise.
	if conn.Status() == whatsapp.StatusConnected {
		return c.JSON(fiber.Map{"status": whatsapp.StatusConnected})
	}

	// Defensive: catch the in-memory-only case where the connection
	// went LoggedOut WITHOUT the DB write yet (event raced ahead of
	// the status persistence). Same recovery path.
	if conn.Status() == whatsapp.StatusLoggedOut {
		if err := h.registry.Purge(c.UserContext(), c.Params("id")); err != nil {
			return internalError(c, fmt.Errorf("purge stale logged_out (post-start): %w", err))
		}
		conn, err = h.registry.Start(c.UserContext(), c.Params("id"))
		if err != nil {
			return internalError(c, fmt.Errorf("restart after post-start purge: %w", err))
		}
	}

	// Subscribe with a one-shot send. sync.Once ensures the channel
	// receives at most once even though the subscriber stays attached
	// for the Connection's lifetime (Connection doesn't expose
	// Unsubscribe yet — fine, downstream events just no-op via the
	// closed flag below).
	type result struct {
		status string
		qr     string
	}
	resultCh := make(chan result, 1)
	var once sync.Once
	send := func(r result) {
		once.Do(func() {
			resultCh <- r
		})
	}

	conn.Subscribe(func(e whatsapp.Event) {
		switch ev := e.(type) {
		case whatsapp.QREvent:
			send(result{status: whatsapp.StatusQR, qr: ev.DataURL})
		case whatsapp.ConnectedEvent:
			send(result{status: whatsapp.StatusConnected})
		case whatsapp.LoggedOutEvent:
			send(result{status: whatsapp.StatusLoggedOut})
		case whatsapp.GiveUpEvent:
			send(result{status: whatsapp.StatusDisconnected})
		}
	})

	select {
	case r := <-resultCh:
		resp := fiber.Map{"status": r.status}
		if r.qr != "" {
			resp["qr"] = r.qr
		}
		return c.JSON(resp)
	case <-time.After(connectTimeout):
		// Connection is still being established — return what we
		// know. Client polls /status to learn the final state.
		return c.JSON(fiber.Map{"status": whatsapp.StatusConnecting})
	case <-c.UserContext().Done():
		return c.JSON(fiber.Map{"status": whatsapp.StatusConnecting})
	}
}

// PairCode POST /v1/wa/instances/:id/pair-code
//
// Starts the normal first-time whatsmeow pairing socket, waits until the QR
// flow is ready, then asks WhatsApp for a phone-linking code. This is the
// "Link with phone number instead" flow in WhatsApp mobile, useful when the
// operator opens Vintra on the same phone that must be linked.
func (h *WaLifecycle) PairCode(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	var body struct {
		Phone string `json:"phone"`
	}
	if err := c.BodyParser(&body); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	phone, err := normalizePairPhone(body.Phone)
	if err != nil {
		return badRequest(c, "nomor WhatsApp tidak valid")
	}

	instance, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: id, TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	if instance.Status == whatsapp.StatusLoggedOut {
		if err := h.registry.Purge(c.UserContext(), c.Params("id")); err != nil {
			return internalError(c, fmt.Errorf("purge stale logged_out session: %w", err))
		}
	}

	conn, err := h.registry.Start(c.UserContext(), c.Params("id"))
	if err != nil {
		return internalError(c, err)
	}

	switch conn.Status() {
	case whatsapp.StatusConnected:
		return c.JSON(fiber.Map{"status": whatsapp.StatusConnected})
	case whatsapp.StatusLoggedOut:
		if err := h.registry.Purge(c.UserContext(), c.Params("id")); err != nil {
			return internalError(c, fmt.Errorf("purge stale logged_out (post-start): %w", err))
		}
		conn, err = h.registry.Start(c.UserContext(), c.Params("id"))
		if err != nil {
			return internalError(c, fmt.Errorf("restart after post-start purge: %w", err))
		}
	}

	if conn.Status() != whatsapp.StatusQR {
		readyCh := make(chan string, 1)
		var once sync.Once
		send := func(status string) {
			once.Do(func() {
				readyCh <- status
			})
		}
		conn.Subscribe(func(e whatsapp.Event) {
			switch e.(type) {
			case whatsapp.QREvent:
				send(whatsapp.StatusQR)
			case whatsapp.ConnectedEvent:
				send(whatsapp.StatusConnected)
			case whatsapp.LoggedOutEvent:
				send(whatsapp.StatusLoggedOut)
			case whatsapp.GiveUpEvent, whatsapp.DisconnectedEvent:
				send(whatsapp.StatusDisconnected)
			}
		})

		select {
		case s := <-readyCh:
			if s == whatsapp.StatusConnected {
				return c.JSON(fiber.Map{"status": whatsapp.StatusConnected})
			}
			if s != whatsapp.StatusQR {
				return c.JSON(fiber.Map{"status": s})
			}
		case <-time.After(pairCodeReadyTimeout):
			// PairPhone often works shortly after Connect even if our
			// one-shot subscriber missed the first QR event. Try once and let
			// the exact whatsmeow error surface if the socket is not ready.
		case <-c.UserContext().Done():
			return c.JSON(fiber.Map{"status": whatsapp.StatusConnecting})
		}
	}

	code, err := conn.PairPhone(c.UserContext(), phone)
	if err != nil {
		return internalError(c, fmt.Errorf("generate WhatsApp pairing code: %w", err))
	}

	return c.JSON(fiber.Map{
		"status": "pair_code",
		"code":   code,
	})
}

// Disconnect POST /v1/wa/instances/:id/disconnect
//
// Tears down the in-memory Connection + closes its SQLite store.
// Idempotent — returns 204 even if no Connection was running.
func (h *WaLifecycle) Disconnect(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Tenant ownership check.
	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: id, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	if err := h.registry.Stop(c.UserContext(), c.Params("id")); err != nil {
		return internalError(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Status GET /v1/wa/instances/:id/status
//
// Reports the current status. Reads from the in-memory Connection if
// one is running; falls back to the wa_instances row otherwise.
func (h *WaLifecycle) Status(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	row, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: id, TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	live := h.registry.Status(c.Params("id"))
	out := fiber.Map{"status": live}
	if !row.LastDisconnectReason.Valid {
		// Send null explicitly so the JS client can distinguish "no
		// reason" from "field absent".
		out["lastDisconnectReason"] = nil
	} else {
		out["lastDisconnectReason"] = row.LastDisconnectReason.String
	}
	return c.JSON(out)
}
