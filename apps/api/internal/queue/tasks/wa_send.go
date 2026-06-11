// Package tasks holds the asynq task handlers. One file per task type.
//
// Handler signatures are `func(context.Context, *asynq.Task) error` —
// returning an error tells asynq to retry per the queue's
// RetryDelayFunc. Returning `asynq.SkipRetry` marks the task as
// permanently failed (used for "bad data, no point retrying"
// scenarios like a malformed JID).
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
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/ratelimit"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// WASendPayload is the JSON shape the producer enqueues. We carry
// only the wa_messages row id — the worker re-fetches every other
// field. Keeps the payload tiny (~50 bytes vs ~500 with full body)
// and avoids stale-content issues if the row is updated between
// enqueue and dispatch.
type WASendPayload struct {
	MessageID string `json:"messageId"` // wa_messages.id (UUID string)
}

// WASendHandler holds the dependencies the wa:send task needs. Built
// once at boot and registered via RegisterWASend below.
type WASendHandler struct {
	Q         *queries.Queries
	Registry  *whatsapp.Registry
	RateLimit *ratelimit.Limiter // optional; nil disables rate limiting
}

// RegisterWASend wires the handler into the given mux for the
// wa:send task type. Call this once at boot from cmd/api/main.go.
func RegisterWASend(mux *asynq.ServeMux, h *WASendHandler) {
	mux.HandleFunc(queue.TaskWASend, h.process)
}

func (h *WASendHandler) process(ctx context.Context, t *asynq.Task) error {
	var p WASendPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		// Bad payload = bug, not transient. Skip retry.
		return fmt.Errorf("unmarshal: %w: %w", err, asynq.SkipRetry)
	}

	msgID, err := db.ParseUUID(p.MessageID)
	if err != nil {
		return fmt.Errorf("parse message id: %w: %w", err, asynq.SkipRetry)
	}

	// Load the row. The worker may run on a delayed retry; the row
	// might have been deleted in the meantime (tenant cleared their
	// instance). Treat ErrNoRows as terminal.
	msg, err := h.Q.GetWaMessage(ctx, msgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("wa:send: message row gone, skipping", "id", p.MessageID)
			return nil
		}
		return fmt.Errorf("get message: %w", err)
	}

	// Already sent? (Idempotency — duplicate enqueues, dead-letter
	// re-runs, etc.) Don't re-send.
	if msg.Status == "sent" {
		return nil
	}

	// Get the live whatsmeow Connection. If it's not running, the
	// send must fail — return an error to retry; the registry's
	// reconnect may have it ready by then.
	conn, err := h.Registry.Get(db.UUIDString(msg.InstanceID))
	if err != nil {
		return fmt.Errorf("instance not connected: %w", err)
	}

	jid, err := types.ParseJID(msg.RemoteJid)
	if err != nil {
		h.markFinalFailure(ctx, msgID, fmt.Errorf("parse jid %q: %w", msg.RemoteJid, err))
		return fmt.Errorf("parse jid: %w: %w", err, asynq.SkipRetry)
	}

	body := ""
	if msg.Body.Valid {
		body = msg.Body.String
	}

	// Rate-limit BEFORE the WhatsApp send. Two-level token bucket
	// (per-instance + per-recipient) prevents bans from accidentally
	// blasting messages too fast. ErrRateLimited surfaces as a normal
	// task error → asynq retries with its own backoff, which spaces
	// out the next attempt naturally.
	if h.RateLimit != nil {
		if err := h.RateLimit.Acquire(ctx, db.UUIDString(msg.InstanceID), msg.RemoteJid); err != nil {
			if errors.Is(err, ratelimit.ErrRateLimited) {
				slog.Warn("wa:send rate-limited, requeue",
					"instance", db.UUIDString(msg.InstanceID),
					"jid", msg.RemoteJid,
				)
			}
			return fmt.Errorf("rate limit: %w", err)
		}
	}

	externalID, err := conn.SendText(ctx, jid, body)
	if err != nil {
		// Retryable. If this attempt was the last, mark as failed
		// before returning so the wa_messages row reflects the
		// terminal state.
		if queue.IsFinalAttempt(ctx) {
			h.markFinalFailure(ctx, msgID, err)
		}
		return fmt.Errorf("whatsmeow send: %w", err)
	}

	if err := h.Q.MarkMessageSent(ctx, queries.MarkMessageSentParams{
		ID:         msgID,
		ExternalID: pgtype.Text{String: externalID, Valid: true},
	}); err != nil {
		slog.Error("wa:send: failed to mark sent", "id", p.MessageID, "err", err)
		// Don't return the error — the message DID send. Better to
		// have a 'pending' row with the message actually delivered
		// than to retry the send and double-deliver.
	}
	return nil
}

// markFinalFailure flips the wa_messages row to 'failed' with the
// error message. Called on the last attempt; never returns its own
// error because the caller is already returning the send error.
func (h *WASendHandler) markFinalFailure(ctx context.Context, msgID pgtype.UUID, sendErr error) {
	errMsg := sendErr.Error()
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}
	if err := h.Q.MarkMessageFailed(ctx, queries.MarkMessageFailedParams{
		ID:           msgID,
		ErrorMessage: pgtype.Text{String: errMsg, Valid: true},
	}); err != nil {
		slog.Error("wa:send: failed to mark final failure",
			"id", db.UUIDString(msgID), "err", err)
	}
}
