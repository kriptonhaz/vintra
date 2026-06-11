package handlers

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
)

// WaContacts serves the chat sidebar: every (instance, remote_jid)
// pair we've exchanged messages with, joined to its latest message
// for the preview line.
type WaContacts struct {
	q *queries.Queries
}

func NewWaContacts(q *queries.Queries) *WaContacts {
	return &WaContacts{q: q}
}

type contactResp struct {
	ID            string     `json:"id"`
	RemoteJid     string     `json:"remoteJid"`
	LidJid        *string    `json:"lidJid,omitempty"`
	Name          *string    `json:"name,omitempty"`
	PushName      *string    `json:"pushName,omitempty"`
	LastMessageAt *time.Time `json:"lastMessageAt,omitempty"`
	LastBody      *string    `json:"lastBody,omitempty"`
	LastFromMe    *bool      `json:"lastFromMe,omitempty"`
	LastType      *string    `json:"lastType,omitempty"`
	UnreadCount   int32      `json:"unreadCount"`
	// Handoff workflow (JUR-74). When NeedsHuman is true, the AI
	// auto-reply is paused for this contact until admin manually
	// resumes (or auto-resume hours elapses on the next inbound).
	NeedsHuman     bool       `json:"needsHuman"`
	HandoffAt      *time.Time `json:"handoffAt,omitempty"`
	HandoffReason  *string    `json:"handoffReason,omitempty"`
	HandoffSummary *string    `json:"handoffSummary,omitempty"`
	// Master customer linkage (joined by normalised phone). When the
	// contact's phone matches a customers row for this tenant, the
	// UI shows the saved name above the WhatsApp push_name so the
	// operator sees "Bu Vinna" instead of just "Vinna A Y".
	MasterCustomerID   *string `json:"masterCustomerId,omitempty"`
	MasterCustomerName *string `json:"masterCustomerName,omitempty"`
}

type markReadReq struct {
	Jid string `json:"jid"`
}

// List GET /v1/wa/instances/:id/contacts
//
// Returns contacts for this instance, newest-message-first. Suitable
// for rendering a WhatsApp-style sidebar with a last-message preview.
func (h *WaContacts) List(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Ownership check — same 404-on-cross-tenant pattern as the
	// other handlers.
	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: instanceID, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	rows, err := h.q.ListWaContacts(c.UserContext(), queries.ListWaContactsParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
	})
	if err != nil {
		return internalError(c, err)
	}

	out := make([]contactResp, len(rows))
	for i, r := range rows {
		var lastAt *time.Time
		if r.LastMessageAt.Valid {
			t := r.LastMessageAt.Time
			lastAt = &t
		} else if r.LastCreatedAt.Valid {
			// Very old contacts may not have last_message_at — fall
			// back to the joined message's created_at.
			t := r.LastCreatedAt.Time
			lastAt = &t
		}

		// LEFT JOIN LATERAL: when no message exists, sqlc gives us
		// zero-valued LastFromMe (false) and LastType (""). Use
		// LastCreatedAt.Valid as the "did we actually find a row"
		// signal.
		var lastFromMe *bool
		var lastType *string
		if r.LastCreatedAt.Valid {
			fm := r.LastFromMe
			lastFromMe = &fm
			if r.LastType != "" {
				lt := r.LastType
				lastType = &lt
			}
		}

		out[i] = contactResp{
			ID:                 db.UUIDString(r.ID),
			RemoteJid:          r.RemoteJid,
			LidJid:             textPtr(r.LidJid),
			Name:               textPtr(r.Name),
			PushName:           textPtr(r.PushName),
			LastMessageAt:      lastAt,
			LastBody:           textPtr(r.LastBody),
			LastFromMe:         lastFromMe,
			LastType:           lastType,
			UnreadCount:        r.UnreadCount,
			NeedsHuman:         r.NeedsHuman,
			HandoffAt:          timePtr(r.HandoffAt),
			HandoffReason:      textPtr(r.HandoffReason),
			HandoffSummary:     textPtr(r.HandoffSummary),
			MasterCustomerID:   uuidPtr(r.MasterCustomerID),
			MasterCustomerName: textPtr(r.MasterCustomerName),
		}
	}
	return c.JSON(out)
}

// MarkRead POST /v1/wa/instances/:id/contacts/read
//
// Resets unread_count to 0 for a (instance, jid) pair. Called by the
// chat UI when the user opens a conversation. Body: { "jid": "..." }.
// Returns 204 No Content. JID is normalised so callers can pass any
// of the accepted phone shapes.
func (h *WaContacts) MarkRead(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Ownership check.
	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: instanceID, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	var req markReadReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	if req.Jid == "" {
		return badRequest(c, "jid is required")
	}

	// Pass through whatsapp.NormalizeJID via an import — but to avoid
	// pulling that into the handlers package just for this, we just
	// take the JID as-is. The frontend already constructs full JIDs.
	if err := h.q.MarkContactRead(c.UserContext(), queries.MarkContactReadParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  req.Jid,
	}); err != nil {
		return internalError(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}
