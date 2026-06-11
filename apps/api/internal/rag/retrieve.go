package rag

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/tier"
)

const (
	toolTimeout  = 500 * time.Millisecond
	totalTimeout = 1500 * time.Millisecond
)

// Retrieve runs all eligible tools in parallel and returns snippets in sort_order.
//
//   - `incomingBody` is the current inbound message — used for trigger gates
//     (MatchesKeywords) and catalog-mode detection. Intent-scoped.
//   - `searchBody` is the search corpus — typically `incomingBody` plus a
//     window of conversation history so entity references like "harganya?"
//     resolve to "Teh Original" mentioned earlier. The worker concatenates
//     history; the preview just passes the same string for both.
//
// Free tier (currentTier == "") returns empty immediately — no RAG for free
// tenants. Retriever errors are logged and skipped; RAG is enriching, not
// critical path. When verbose=true, each Snippet.RawRows is populated (admin
// preview only).
func Retrieve(
	ctx context.Context,
	db queries.DBTX,
	tenantID pgtype.UUID,
	currentTier, remoteJid, incomingBody, searchBody string,
	tools []queries.GetInstanceEnabledRagToolsRow,
	verbose bool,
) ([]Snippet, error) {
	// Free tier: skip all retrieval.
	if currentTier == "" {
		return nil, nil
	}

	// Catalog mode is decided by the customer's CURRENT intent — never by
	// stale history words. Search tokens use the wider corpus.
	isCatalog := IsCatalogQuery(Tokenize(incomingBody))
	tokens := Tokenize(searchBody)

	// Pre-allocate result slots to preserve sort_order without a map.
	result := make([]*Snippet, len(tools))

	ctx, cancel := context.WithTimeout(ctx, totalTimeout)
	defer cancel()

	var wg sync.WaitGroup
	for i, tool := range tools {
		// Tier gate
		if !tier.AtLeast(currentTier, tool.MinTier) {
			continue
		}
		// Trigger gate runs against the CURRENT message only — past mentions
		// of "harga" / "stok" / "jam" shouldn't re-fire tools every turn.
		switch tool.TriggerMode {
		case "on_keyword":
			if !MatchesKeywords(incomingBody, tool.TriggerKeywords) {
				continue
			}
		case "on_customer_match":
			if remoteJid == "" {
				continue
			}
		}

		impl, ok := retrieverFor[tool.RetrievalType]
		if !ok {
			slog.Warn("rag: unknown retrieval_type", "type", tool.RetrievalType)
			continue
		}

		wg.Add(1)
		go func(idx int, t queries.GetInstanceEnabledRagToolsRow, r Retriever) {
			defer wg.Done()

			// Bail out before touching the DB if the outer context is
			// already done (e.g. the caller's request handler returned).
			// Without this check, a pre-canceled context would still
			// invoke retriever code that dereferences the pool.
			if ctx.Err() != nil {
				return
			}

			tCtx, tCancel := context.WithTimeout(ctx, toolTimeout)
			defer tCancel()

			start := time.Now()
			snippets, err := r.Retrieve(tCtx, db, tenantID, remoteJid, tokens, isCatalog, verbose)
			ms := time.Since(start).Milliseconds()

			if err != nil {
				slog.Warn("rag: tool skipped", "tool", t.Name, "err", err)
				return
			}
			if len(snippets) == 0 {
				return
			}
			// Take first snippet (each retriever returns at most one aggregated snippet).
			s := snippets[0]
			s.ToolID = t.ID.String()
			s.LatencyMs = ms
			result[idx] = &s
		}(i, tool, impl)
	}
	wg.Wait()

	// Collect non-nil slots in order.
	out := make([]Snippet, 0, len(result))
	for _, s := range result {
		if s != nil {
			out = append(out, *s)
		}
	}
	return out, nil
}
