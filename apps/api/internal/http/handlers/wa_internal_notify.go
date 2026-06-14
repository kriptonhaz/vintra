package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	queuetasks "github.com/kriptonhaz/vintra/apps/api/internal/queue/tasks"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// WaInternalNotify backs POST /v1/internal/wa/notify — a server-to-server
// send used by the web app's unauthenticated storefront checkout to push
// a "new order" message to the tenant's configured admin number. Authed
// via INTERNAL_SERVICE_TOKEN (NOT a per-user JWT), so the tenant id +
// instance id come in the body rather than from auth context.
//
// The recipient is always the instance's own `admin_phone`; the caller
// never supplies an arbitrary destination. If the instance has no admin
// phone configured, this is a no-op (200 {skipped:true}) — the storefront
// falls back to the customer-initiated wa.me deep link.
type WaInternalNotify struct {
	q     *queries.Queries
	asynq *queue.Client
}

func NewWaInternalNotify(q *queries.Queries, asynqClient *queue.Client) *WaInternalNotify {
	return &WaInternalNotify{q: q, asynq: asynqClient}
}

type internalNotifyReq struct {
	TenantID   string `json:"tenantId"`
	InstanceID string `json:"instanceId"`
	Body       string `json:"body"`
}

// Send POST /v1/internal/wa/notify
func (h *WaInternalNotify) Send(c *fiber.Ctx) error {
	var req internalNotifyReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	if strings.TrimSpace(req.Body) == "" {
		return badRequest(c, "body is required")
	}
	if l := len(req.Body); l > 4000 {
		return badRequest(c, "body too long (max 4000 chars)")
	}

	instanceID, err := db.ParseUUID(req.InstanceID)
	if err != nil {
		return badRequest(c, "invalid instance id")
	}
	tenantID, err := db.ParseUUID(req.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	inst, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: instanceID, TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	if !inst.AdminPhone.Valid || strings.TrimSpace(inst.AdminPhone.String) == "" {
		// Nothing to notify — not an error.
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"skipped": true})
	}

	jid, err := whatsapp.NormalizeJID(inst.AdminPhone.String)
	if err != nil {
		return badRequest(c, "invalid admin phone: "+err.Error())
	}

	msg, err := h.q.CreateOutboundMessage(c.UserContext(), queries.CreateOutboundMessageParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  jid,
		Type:       "text",
		Body:       pgtype.Text{String: req.Body, Valid: true},
	})
	if err != nil {
		return internalError(c, err)
	}

	payload, _ := json.Marshal(queuetasks.WASendPayload{MessageID: db.UUIDString(msg.ID)})
	task := asynq.NewTask(queue.TaskWASend, payload)

	enqueueCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := h.asynq.EnqueueContext(enqueueCtx, task,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(3),
		asynq.Timeout(30*time.Second),
	); err != nil {
		_ = h.q.MarkMessageFailed(enqueueCtx, queries.MarkMessageFailedParams{
			ID:           msg.ID,
			ErrorMessage: pgtype.Text{String: "enqueue failed: " + err.Error(), Valid: true},
		})
		return internalError(c, err)
	}

	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"ok": true})
}
