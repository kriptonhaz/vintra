package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// pgUniqueViolation is Postgres SQLSTATE 23505 — wa_contacts has a
// unique (instance_id, remote_jid) index, so if a PN-form contact
// already exists when we try to rename a LID-form row to the same PN,
// the UPDATE fails with this code. v1 treats it as "merge needed" and
// no-ops (logged warn) so we don't lose either contact's data; a v2
// follow-up can implement the actual merge path.
const pgUniqueViolation = "23505"

// WALidBackfillHandler renames a LID-form wa_contacts row (and its
// linked wa_messages) to the newly-discovered PN form. Triggered by
// the inbound subscriber when whatsmeow's local LID store resolves
// a previously-seen LID to a PN.
type WALidBackfillHandler struct {
	Q  *queries.Queries
	DB *pgxpool.Pool
}

// RegisterWALidBackfill wires the handler into the asynq mux. Called
// once at boot from cmd/api/main.go.
func RegisterWALidBackfill(mux *asynq.ServeMux, h *WALidBackfillHandler) {
	mux.HandleFunc(queue.TaskWALidBackfill, h.process)
}

func (h *WALidBackfillHandler) process(ctx context.Context, t *asynq.Task) error {
	var p whatsapp.LidBackfillPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal: %w: %w", err, asynq.SkipRetry)
	}

	instanceID, err := db.ParseUUID(p.InstanceID)
	if err != nil {
		return fmt.Errorf("parse instance id: %w: %w", err, asynq.SkipRetry)
	}
	if p.OldLid == "" || p.NewPn == "" || p.OldLid == p.NewPn {
		// Defensive: bad payload, don't retry.
		slog.Warn("lid_backfill bad payload, skipping",
			"instance", p.InstanceID, "lid", p.OldLid, "pn", p.NewPn)
		return nil
	}

	tx, err := h.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	qtx := h.Q.WithTx(tx)

	// Rename the contact first. If the LID row doesn't exist anymore
	// (already migrated by an earlier event, or never created), we get
	// 0 rows affected and have nothing else to do.
	contactRows, err := qtx.RenameWaContactJid(ctx, queries.RenameWaContactJidParams{
		InstanceID:  instanceID,
		LidJid:      pgtype.Text{String: p.OldLid, Valid: true},
		RemoteJid:   p.NewPn,
	})
	if err != nil {
		// Unique violation = PN-form contact already exists for this
		// person (rare: same identity messaged from two devices, one
		// disclosed PN, one didn't). v1 best-effort: log + return ok.
		// Merge path is a follow-up.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			slog.Warn("lid_backfill skipped — PN contact already exists, merge deferred",
				"instance", p.InstanceID, "lid", p.OldLid, "pn", p.NewPn)
			return nil
		}
		return fmt.Errorf("rename contact: %w", err)
	}
	if contactRows == 0 {
		slog.Debug("lid_backfill no-op — LID contact not found",
			"instance", p.InstanceID, "lid", p.OldLid, "pn", p.NewPn)
		return nil
	}

	messageRows, err := qtx.RenameWaMessagesJid(ctx, queries.RenameWaMessagesJidParams{
		InstanceID:  instanceID,
		RemoteJid:   p.OldLid,
		RemoteJid_2: p.NewPn,
	})
	if err != nil {
		return fmt.Errorf("rename messages: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	slog.Info("lid_backfill completed",
		"instance", p.InstanceID,
		"lid", p.OldLid,
		"pn", p.NewPn,
		"contactRows", contactRows,
		"messageRows", messageRows,
	)
	return nil
}
