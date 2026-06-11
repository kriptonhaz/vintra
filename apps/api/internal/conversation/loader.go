// Package conversation loads message history for the AI prompt builder.
// It is a thin query wrapper — no business logic here.
package conversation

import (
	"context"
	"fmt"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
)

// Message is one turn in a WhatsApp conversation, normalised for the
// prompt builder. FromMe=true → assistant turn; false → user turn.
type Message struct {
	FromMe  bool
	Content string
}

// Loader fetches conversation tails from wa_messages.
type Loader struct {
	q *queries.Queries
}

// New constructs a Loader backed by the given sqlc Queries handle.
func New(q *queries.Queries) *Loader {
	return &Loader{q: q}
}

// GetTail returns the last N messages for (instanceID, remoteJid),
// oldest-first so the slice maps directly to prompt order
// (system → ... → oldest history → newest history → incoming).
//
// If limit ≤ 0 it defaults to 10.
func (l *Loader) GetTail(ctx context.Context, instanceID, remoteJid string, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 10
	}

	iid, err := db.ParseUUID(instanceID)
	if err != nil {
		return nil, fmt.Errorf("conversation: parse instance id: %w", err)
	}

	rows, err := l.q.ListConversationTail(ctx, queries.ListConversationTailParams{
		InstanceID: iid,
		RemoteJid:  remoteJid,
		Limit:      int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("conversation: list tail: %w", err)
	}

	// Rows arrive newest-first from DB; reverse to chronological order.
	msgs := make([]Message, len(rows))
	for i, r := range rows {
		body := ""
		if r.Body.Valid {
			body = r.Body.String
		}
		msgs[len(rows)-1-i] = Message{
			FromMe:  r.FromMe,
			Content: body,
		}
	}

	return msgs, nil
}
