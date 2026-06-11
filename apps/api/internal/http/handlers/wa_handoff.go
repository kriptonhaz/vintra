package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
)

// WaHandoff serves the manual resume / pause endpoint for the handoff
// workflow. The chat detail UI calls PATCH .../handoff with
// `{remoteJid, enabled}` when admin clicks "Jeda AI" / "Aktifkan AI".
//
// The JID lives in the body (not a path param) because Fiber treats
// `.` as a route delimiter and silently truncates JIDs like
// `6285...@s.whatsapp.net`, which made the prior `:remoteJid` path
// version match zero rows and silently no-op.
//
// Setting enabled=true is also supported — it lets admin manually pause
// the AI for a contact even when the AI itself didn't trigger a handoff
// (e.g., admin sees a sensitive conversation and wants to take over).
type WaHandoff struct {
	q *queries.Queries
}

func NewWaHandoff(q *queries.Queries) *WaHandoff {
	return &WaHandoff{q: q}
}

type updateHandoffReq struct {
	RemoteJid string `json:"remoteJid"`
	Enabled   bool   `json:"enabled"`
	Reason    string `json:"reason,omitempty"` // optional, only used when manually enabling
}

// Update PATCH /v1/wa/instances/:id/contacts/handoff
func (h *WaHandoff) Update(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}
	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}

	// Tenant-scope check: instance must belong to caller's tenant.
	// Without this, a malicious tenant could clear handoffs on someone
	// else's chat. Fast: GetWaInstance returns 404-shaped error when
	// the row exists for another tenant.
	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID:       instanceID,
		TenantID: tenantID,
	}); err != nil {
		return notFound(c)
	}

	var req updateHandoffReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	remoteJid := req.RemoteJid
	if remoteJid == "" {
		return badRequest(c, "remoteJid is required")
	}

	var rows int64
	if req.Enabled {
		// Manual handoff trigger — admin pre-empting AI.
		reason := req.Reason
		if reason == "" {
			reason = "ditandai oleh admin"
		}
		rows, err = h.q.SetWaContactHandoff(c.UserContext(), queries.SetWaContactHandoffParams{
			InstanceID:     instanceID,
			RemoteJid:      remoteJid,
			HandoffReason:  pgtype.Text{String: reason, Valid: true},
			HandoffSummary: pgtype.Text{String: "", Valid: false},
		})
	} else {
		// Manual resume — clear flag.
		rows, err = h.q.ClearWaContactHandoff(c.UserContext(), queries.ClearWaContactHandoffParams{
			InstanceID: instanceID,
			RemoteJid:  remoteJid,
		})
	}
	if err != nil {
		return internalError(c, err)
	}
	// Zero rows means the (instance_id, remote_jid) pair doesn't match
	// any wa_contact. The previous version silently returned 200, which
	// made the UI button look broken because the toggle's state never
	// flipped. 404 is the honest answer.
	if rows == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":     "contact not found for this instance",
			"remoteJid": remoteJid,
		})
	}

	return c.JSON(fiber.Map{"ok": true, "enabled": req.Enabled})
}
