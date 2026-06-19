package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

// LoyaltyInternal backs POST /v1/internal/loyalty/render-card — a
// server-to-server trigger the web app calls after a merchant saves a
// stamp-card design. Authed via INTERNAL_SERVICE_TOKEN (the web has
// already verified the user owns the tenant + program), so the tenant
// and program ids arrive in the body. It flips the program to 'pending'
// and enqueues the heavy render onto the loyalty:render queue.
type LoyaltyInternal struct {
	q     *queries.Queries
	pool  queries.DBTX
	asynq *queue.Client
}

func NewLoyaltyInternal(
	q *queries.Queries,
	pool queries.DBTX,
	asynqClient *queue.Client,
) *LoyaltyInternal {
	return &LoyaltyInternal{q: q, pool: pool, asynq: asynqClient}
}

type renderCardReq struct {
	TenantID  string `json:"tenantId"`
	ProgramID string `json:"programId"`
}

// RenderCard POST /v1/internal/loyalty/render-card
func (h *LoyaltyInternal) RenderCard(c *fiber.Ctx) error {
	var req renderCardReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	programID, err := db.ParseUUID(req.ProgramID)
	if err != nil {
		return badRequest(c, "invalid program id")
	}
	tenantID, err := db.ParseUUID(req.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Flip to 'pending' and confirm the program exists + is owned by the
	// tenant in one statement. Zero rows → not found.
	tag, err := h.pool.Exec(c.UserContext(), `
		UPDATE loyalty_stamp_programs
		SET card_render_status = 'pending'
		WHERE id = $1 AND tenant_id = $2`,
		programID, tenantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}
	if tag.RowsAffected() == 0 {
		return notFound(c)
	}

	payload, _ := json.Marshal(queuetasks.LoyaltyRenderCardPayload{
		TenantID:  req.TenantID,
		ProgramID: req.ProgramID,
	})
	task := asynq.NewTask(queue.TaskLoyaltyRenderCard, payload)

	enqueueCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := h.asynq.EnqueueContext(enqueueCtx, task,
		asynq.Queue(queue.QueueLoyaltyRender),
		asynq.MaxRetry(3),
		asynq.Timeout(2*time.Minute),
	); err != nil {
		return internalError(c, err)
	}

	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"ok": true})
}

type sendCardReq struct {
	TenantID   string `json:"tenantId"`
	CustomerID string `json:"customerId"`
	ProgramID  string `json:"programId"`
}

// SendCard POST /v1/internal/loyalty/send-card — manual "Kirim kartu"
// from the dashboard. Looks up the customer's current stamp count, picks
// the pre-rendered card for that exact state, and sends it over WhatsApp
// with an Indonesian caption from the tenant's connected instance.
func (h *LoyaltyInternal) SendCard(c *fiber.Ctx) error {
	var req sendCardReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	tenantID, err := db.ParseUUID(req.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}
	customerID, err := db.ParseUUID(req.CustomerID)
	if err != nil {
		return badRequest(c, "invalid customer id")
	}
	programID, err := db.ParseUUID(req.ProgramID)
	if err != nil {
		return badRequest(c, "invalid program id")
	}
	ctx := c.UserContext()

	// Customer phone — required to send.
	var phone pgtype.Text
	if err := h.pool.QueryRow(ctx,
		`SELECT phone FROM customers WHERE id = $1 AND tenant_id = $2`,
		customerID, tenantID).Scan(&phone); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}
	if !phone.Valid || phone.String == "" {
		return badRequest(c, "pelanggan belum punya nomor WhatsApp")
	}

	// Program name + threshold for the caption.
	var progName string
	var stampsRequired int32
	if err := h.pool.QueryRow(ctx,
		`SELECT name, stamps_required FROM loyalty_stamp_programs
		 WHERE id = $1 AND tenant_id = $2`,
		programID, tenantID).Scan(&progName, &stampsRequired); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	// Current fill state (0 if the customer has no card row yet).
	var current int32
	_ = h.pool.QueryRow(ctx,
		`SELECT current_stamps FROM customer_stamp_cards
		 WHERE customer_id = $1 AND program_id = $2 AND tenant_id = $3`,
		customerID, programID, tenantID).Scan(&current)

	// Pre-rendered card for that exact state.
	var imageKey string
	if err := h.pool.QueryRow(ctx,
		`SELECT image_key FROM loyalty_stamp_program_cards
		 WHERE program_id = $1 AND stamp_count = $2`,
		programID, current).Scan(&imageKey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "kartu belum dibuat — simpan desain kartu terlebih dahulu",
			})
		}
		return internalError(c, err)
	}

	// Pick the tenant's connected instance (most recently connected).
	var instanceID pgtype.UUID
	if err := h.pool.QueryRow(ctx,
		`SELECT id FROM wa_instances
		 WHERE tenant_id = $1 AND status = 'connected'
		 ORDER BY last_connected_at DESC NULLS LAST
		 LIMIT 1`,
		tenantID).Scan(&instanceID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "tidak ada WhatsApp yang terhubung",
			})
		}
		return internalError(c, err)
	}

	jid, err := whatsapp.NormalizeJID(phone.String)
	if err != nil {
		return badRequest(c, "nomor WhatsApp pelanggan tidak valid")
	}

	remaining := int(stampsRequired) - int(current)
	var caption string
	if remaining <= 0 {
		caption = fmt.Sprintf(
			"Kartu stempel %s kamu sudah penuh (%d/%d)! 🎉 Tunjukkan pesan ini untuk klaim hadiahmu ya.",
			progName, current, stampsRequired)
	} else {
		caption = fmt.Sprintf(
			"Kartu stempel %s kamu: %d/%d. Tinggal %d lagi untuk dapat hadiah gratis! 🙌",
			progName, current, stampsRequired, remaining)
	}

	msg, err := h.q.CreateOutboundImageMessage(ctx, queries.CreateOutboundImageMessageParams{
		TenantID:       tenantID,
		InstanceID:     instanceID,
		RemoteJid:      jid,
		Body:           pgtype.Text{String: caption, Valid: true},
		MediaKey:       pgtype.Text{String: imageKey, Valid: true},
		MediaMime:      pgtype.Text{String: "image/png", Valid: true},
		MediaSizeBytes: pgtype.Int4{Valid: false},
	})
	if err != nil {
		return internalError(c, err)
	}

	payload, _ := json.Marshal(queuetasks.WASendPayload{MessageID: db.UUIDString(msg.ID)})
	task := asynq.NewTask(queue.TaskWASendImage, payload)
	enqueueCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := h.asynq.EnqueueContext(enqueueCtx, task,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(2),
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
