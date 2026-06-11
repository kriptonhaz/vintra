package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/walogin"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// enqueueAIReply enqueues an ai:reply task when the instance has AI
// auto-reply enabled. Errors are logged but not propagated — a failure
// to enqueue the AI task must NOT roll back the inbound message persist.
func enqueueAIReply(ctx context.Context, client *asynq.Client, p whatsapp.InboundPayload, messageID string) {
	payload, err := json.Marshal(AIReplyPayload{
		TenantID:   p.TenantID,
		InstanceID: p.InstanceID,
		RemoteJid:  p.RemoteJid,
		MessageID:  messageID,
	})
	if err != nil {
		slog.Error("ai:reply enqueue marshal failed", "err", err)
		return
	}
	task := asynq.NewTask(queue.TaskAIReply, payload,
		asynq.Queue(queue.QueueAIReply),
		asynq.MaxRetry(2),
	)
	if _, err := client.EnqueueContext(ctx, task); err != nil {
		slog.Error("ai:reply enqueue failed", "instance", p.InstanceID, "jid", p.RemoteJid, "err", err)
	}
}

// WAIncomingHandler persists inbound WhatsApp messages.
type WAIncomingHandler struct {
	Q           *queries.Queries
	AsynqClient *asynq.Client // for enqueuing ai:reply tasks
	// WALogin is the staff OTP-login service. When non-nil and the
	// inbound message matches the OTP-request pattern AND the sender's
	// phone belongs to an opt-in tenant_member, the handler issues an
	// OTP reply and skips the ai:reply dispatch. Nil = feature disabled
	// globally; intended for emergency rollback. Per-instance / per-
	// tenant gating lives in the service itself.
	WALogin *walogin.Service
}

// RegisterWAIncoming wires the handler into the given mux for the
// wa:incoming task type. Called once at boot from cmd/api/main.go.
func RegisterWAIncoming(mux *asynq.ServeMux, h *WAIncomingHandler) {
	mux.HandleFunc(queue.TaskWAIncoming, h.process)
}

func (h *WAIncomingHandler) process(ctx context.Context, t *asynq.Task) error {
	var p whatsapp.InboundPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal: %w: %w", err, asynq.SkipRetry)
	}

	instanceID, err := db.ParseUUID(p.InstanceID)
	if err != nil {
		return fmt.Errorf("parse instance id: %w: %w", err, asynq.SkipRetry)
	}
	tenantID, err := db.ParseUUID(p.TenantID)
	if err != nil {
		return fmt.Errorf("parse tenant id: %w: %w", err, asynq.SkipRetry)
	}

	// Branch on FromMe: true = multi-device echo (you sent from your
	// phone), false = real inbound from the contact.
	var messageID string

	if p.FromMe {
		msg, err := h.Q.CreateInboundEcho(ctx, queries.CreateInboundEchoParams{
			TenantID:       tenantID,
			InstanceID:     instanceID,
			RemoteJid:      p.RemoteJid,
			ExternalID:     pgtype.Text{String: p.ExternalID, Valid: true},
			Type:           p.Type,
			Body:           textOrNull(p.Body),
			MediaKey:       textOrNull(p.MediaS3Key),
			MediaMime:      textOrNull(p.MediaMime),
			MediaSizeBytes: int4OrNull(p.MediaSizeBytes),
		})
		if err != nil {
			return fmt.Errorf("insert echo: %w", err)
		}
		messageID = db.UUIDString(msg.ID)

		// Echo: only bump last_message_at — DON'T increment unread,
		// the user already saw this on the device that sent it.
		if err := h.Q.UpsertWaContactEcho(ctx, queries.UpsertWaContactEchoParams{
			TenantID:   tenantID,
			InstanceID: instanceID,
			RemoteJid:  p.RemoteJid,
			LidJid:     textOrNull(p.LidJid),
		}); err != nil {
			return fmt.Errorf("upsert contact (echo): %w", err)
		}
	} else {
		msg, err := h.Q.CreateInboundMessage(ctx, queries.CreateInboundMessageParams{
			TenantID:       tenantID,
			InstanceID:     instanceID,
			RemoteJid:      p.RemoteJid,
			ExternalID:     pgtype.Text{String: p.ExternalID, Valid: true},
			Type:           p.Type,
			Body:           textOrNull(p.Body),
			MediaKey:       textOrNull(p.MediaS3Key),
			MediaMime:      textOrNull(p.MediaMime),
			MediaSizeBytes: int4OrNull(p.MediaSizeBytes),
		})
		if err != nil {
			return fmt.Errorf("insert inbound: %w", err)
		}
		messageID = db.UUIDString(msg.ID)

		// Inbound from contact: upsert contact AND bump unread.
		// LidJid is the LID form of the same identity (paired with
		// the PN as remote_jid) — COALESCE in the SQL keeps any
		// previously-known LID if this message didn't include one.
		if err := h.Q.UpsertWaContact(ctx, queries.UpsertWaContactParams{
			TenantID:   tenantID,
			InstanceID: instanceID,
			RemoteJid:  p.RemoteJid,
			LidJid:     textOrNull(p.LidJid),
			PushName:   textOrNull(p.PushName),
		}); err != nil {
			return fmt.Errorf("upsert contact: %w", err)
		}
	}

	slog.Info("inbound persisted",
		"instance", p.InstanceID,
		"jid", p.RemoteJid,
		"messageId", messageID,
		"type", p.Type,
		"fromMe", p.FromMe,
	)

	// Staff WhatsApp OTP login (JUR-wa-login). Intercept inbound
	// messages from opted-in staff that match the OTP-request pattern
	// BEFORE the AI dispatch — otherwise the AI would generate a
	// useless reply on top of the actual OTP we want to send.
	//
	// The service no-ops on:
	//   - feature off for this instance (otp_login_enabled = false)
	//   - tenant not on basic+ tier
	//   - phone doesn't belong to any opt-in staff
	//   - rate-limited (returns handled=true → suppress AI silently)
	//
	// Errors are logged but not propagated — failing the inbound task
	// would re-run the message persist and double-count the unread.
	if !p.FromMe && p.Body != "" && h.WALogin != nil {
		handled, err := h.WALogin.HandleInboundOtpRequest(
			ctx,
			p.InstanceID, p.TenantID, p.RemoteJid, p.Body,
		)
		if err != nil {
			slog.Error("wa-login: inbound handler failed",
				"instance", p.InstanceID, "jid", p.RemoteJid, "err", err)
		}
		if handled {
			return nil
		}
	}

	// Enqueue ai:reply for inbound messages with text content when the
	// instance has AI auto-reply enabled. We fetch the instance to check
	// ai_enabled; the worker re-fetches it on dispatch (settings may change).
	//
	// Image / video / document messages with a CAPTION are routed to the
	// AI too — `Body` carries the caption (provider extracts via
	// GetImageMessage().GetCaption() etc). Without text content, AI has
	// nothing to respond to (vision is out of scope for v1), so skip.
	// Voice / sticker / pure-image messages without captions silently
	// drop here; admin sees them in the chat sidebar but AI doesn't reply.
	if !p.FromMe && p.Body != "" && h.AsynqClient != nil {
		instance, err := h.Q.GetWaInstance(ctx, queries.GetWaInstanceParams{
			ID:       instanceID,
			TenantID: tenantID,
		})
		if err == nil && instance.AiEnabled {
			enqueueAIReply(ctx, h.AsynqClient, p, messageID)
		}
	}

	return nil
}

func textOrNull(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

// int4OrNull treats 0 as "not set" so the caller can pass through media
// size from InboundPayload where 0 is the zero value for "no media".
// Real media bytes are always > 0, so this is safe.
func int4OrNull(n int64) pgtype.Int4 {
	if n <= 0 {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: int32(n), Valid: true}
}
