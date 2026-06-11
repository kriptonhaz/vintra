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

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// WAReactionHandler persists inbound emoji reactions (JUR-80). One row
// per (parent_message_id, sender_jid) — same sender swapping their
// reaction overwrites in place, removing it deletes the row.
type WAReactionHandler struct {
	Q *queries.Queries
}

// RegisterWAReaction wires the handler into the asynq mux. Called
// once at boot from cmd/api/main.go.
func RegisterWAReaction(mux *asynq.ServeMux, h *WAReactionHandler) {
	mux.HandleFunc(queue.TaskWAReaction, h.process)
}

func (h *WAReactionHandler) process(ctx context.Context, t *asynq.Task) error {
	var p whatsapp.ReactionPayload
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

	// Resolve parent_message_id by external id. If the message is
	// missing (admin deleted it, or it arrived after a retention purge),
	// log warn + return success — no point retrying a reaction whose
	// parent is gone.
	parentID, err := h.Q.FindWaMessageByExternalID(ctx, queries.FindWaMessageByExternalIDParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		ExternalID: pgtype.Text{String: p.ParentExternalID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("reaction parent not found, dropping",
				"instance", p.InstanceID,
				"parent", p.ParentExternalID,
				"sender", p.SenderJid,
			)
			return nil
		}
		return fmt.Errorf("find parent: %w", err)
	}

	// Empty emoji = whatsmeow's "reaction removed" signal. Drop the
	// row so the bubble's pill disappears. No audit history for v2.
	if p.Emoji == "" {
		if err := h.Q.DeleteWaReaction(ctx, queries.DeleteWaReactionParams{
			ParentMessageID: parentID,
			SenderJid:       p.SenderJid,
		}); err != nil {
			return fmt.Errorf("delete reaction: %w", err)
		}
		slog.Info("reaction removed",
			"instance", p.InstanceID,
			"parent", p.ParentExternalID,
			"sender", p.SenderJid,
		)
		return nil
	}

	if err := h.Q.UpsertWaReaction(ctx, queries.UpsertWaReactionParams{
		TenantID:        tenantID,
		InstanceID:      instanceID,
		ParentMessageID: parentID,
		SenderJid:       p.SenderJid,
		Emoji:           p.Emoji,
	}); err != nil {
		return fmt.Errorf("upsert reaction: %w", err)
	}
	slog.Info("reaction stored",
		"instance", p.InstanceID,
		"parent", p.ParentExternalID,
		"sender", p.SenderJid,
		"emoji", p.Emoji,
	)
	return nil
}
