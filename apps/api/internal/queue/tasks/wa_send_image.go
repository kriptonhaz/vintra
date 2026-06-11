package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"go.mau.fi/whatsmeow/types"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/ratelimit"
	"github.com/kriptonhaz/vintra/apps/api/internal/storage"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// WASendImageHandler is the wa:send_image task processor (JUR-76).
// Mirrors WASendHandler — same rate-limit, same idempotency rules,
// same retry-on-transient-error pattern. The only differences are:
//
//   - reads media_key from wa_messages, downloads bytes from S3, then
//     uploads to WhatsApp's media servers via whatsmeow.Client.Upload
//     before sending the ImageMessage.
//   - uses Connection.SendImage (not SendText).
type WASendImageHandler struct {
	Q         *queries.Queries
	Registry  *whatsapp.Registry
	S3        *storage.Client
	RateLimit *ratelimit.Limiter // optional; nil disables rate limiting
}

// RegisterWASendImage wires the handler into the given mux for the
// wa:send_image task type. Called once at boot from cmd/api/main.go.
func RegisterWASendImage(mux *asynq.ServeMux, h *WASendImageHandler) {
	mux.HandleFunc(queue.TaskWASendImage, h.process)
}

func (h *WASendImageHandler) process(ctx context.Context, t *asynq.Task) error {
	var p WASendPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal: %w: %w", err, asynq.SkipRetry)
	}

	msgID, err := db.ParseUUID(p.MessageID)
	if err != nil {
		return fmt.Errorf("parse message id: %w: %w", err, asynq.SkipRetry)
	}

	msg, err := h.Q.GetWaMessage(ctx, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("wa:send_image: message row gone, skipping", "id", p.MessageID)
			return nil
		}
		return fmt.Errorf("get message: %w", err)
	}
	if msg.Status == "sent" {
		return nil // idempotency
	}
	if !msg.MediaKey.Valid || msg.MediaKey.String == "" {
		// Bug — caller enqueued an image task with no key. Mark
		// failed and skip retry.
		h.markFinalFailure(ctx, msgID, errors.New("media_key missing"))
		return fmt.Errorf("media_key missing: %w", asynq.SkipRetry)
	}
	if h.S3 == nil {
		// Misconfigured: S3 client unavailable. Don't burn retries —
		// the binary needs to be redeployed with creds before this
		// task can succeed.
		h.markFinalFailure(ctx, msgID, errors.New("S3 client not configured"))
		return fmt.Errorf("s3 client unavailable: %w", asynq.SkipRetry)
	}

	conn, err := h.Registry.Get(db.UUIDString(msg.InstanceID))
	if err != nil {
		return fmt.Errorf("instance not connected: %w", err)
	}

	jid, err := types.ParseJID(msg.RemoteJid)
	if err != nil {
		h.markFinalFailure(ctx, msgID, fmt.Errorf("parse jid %q: %w", msg.RemoteJid, err))
		return fmt.Errorf("parse jid: %w: %w", err, asynq.SkipRetry)
	}

	caption := ""
	if msg.Body.Valid {
		caption = msg.Body.String
	}
	mime := "image/jpeg"
	if msg.MediaMime.Valid {
		mime = msg.MediaMime.String
	}

	// Download from S3 (where the web app put the operator's pick).
	data, err := h.S3.Get(ctx, msg.MediaKey.String)
	if err != nil {
		// S3 fetch failures retry — could be a transient AWS blip.
		// On final attempt, mark failed.
		if queue.IsFinalAttempt(ctx) {
			h.markFinalFailure(ctx, msgID, fmt.Errorf("s3 fetch: %w", err))
		}
		return fmt.Errorf("s3 get %s: %w", msg.MediaKey.String, err)
	}

	// Same rate-limit budget as text sends. Image is just a heavier
	// payload at the WhatsApp layer; the per-JID throttle still
	// applies.
	if h.RateLimit != nil {
		if err := h.RateLimit.Acquire(ctx, db.UUIDString(msg.InstanceID), msg.RemoteJid); err != nil {
			if errors.Is(err, ratelimit.ErrRateLimited) {
				slog.Warn("wa:send_image rate-limited, requeue",
					"instance", db.UUIDString(msg.InstanceID),
					"jid", msg.RemoteJid,
				)
			}
			return fmt.Errorf("rate limit: %w", err)
		}
	}

	externalID, err := conn.SendImage(ctx, jid, data, mime, caption)
	if err != nil {
		if queue.IsFinalAttempt(ctx) {
			h.markFinalFailure(ctx, msgID, err)
		}
		return fmt.Errorf("whatsmeow send image: %w", err)
	}

	if err := h.Q.MarkMessageSent(ctx, queries.MarkMessageSentParams{
		ID:         msgID,
		ExternalID: pgtype.Text{String: externalID, Valid: true},
	}); err != nil {
		// Same "don't double-send" reasoning as wa_send.
		slog.Error("wa:send_image: failed to mark sent",
			"id", p.MessageID, "err", err)
	}
	return nil
}

func (h *WASendImageHandler) markFinalFailure(ctx context.Context, msgID pgtype.UUID, sendErr error) {
	errMsg := sendErr.Error()
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}
	if err := h.Q.MarkMessageFailed(ctx, queries.MarkMessageFailedParams{
		ID:           msgID,
		ErrorMessage: pgtype.Text{String: errMsg, Valid: true},
	}); err != nil {
		slog.Error("wa:send_image: failed to mark final failure",
			"id", db.UUIDString(msgID), "err", err)
	}
}
