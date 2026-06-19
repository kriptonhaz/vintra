// Package queue wraps asynq for the WhatsApp api.
//
// Task types live under named queues:
//
//	wa:send         — outbound messages (concurrency 2)
//	wa:incoming     — inbound persistence (concurrency 2)
//	wa:reaction     — emoji-reaction persistence (concurrency 1, JUR-80)
//	wa:lid_backfill — rename LID→PN on wa_contacts + wa_messages (concurrency 1, JUR-93)
//	ai:reply        — AI auto-reply generation (concurrency 1)
//
// All use the same Redis instance (REDIS_URL). asynq's queue names
// aren't restricted by character — colons work fine here (unlike
// BullMQ which rejects them).
package queue

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
)

// Queue names. Importable from anywhere — task producers use them in
// asynq.Queue() options, the server config wires them to weights.
const (
	QueueWASend        = "wa:send"
	QueueWAIncoming    = "wa:incoming"
	QueueWAReaction    = "wa:reaction"
	QueueWALidBackfill = "wa:lid_backfill"
	QueueAIReply       = "ai:reply"
	QueueLoyaltyRender = "loyalty:render"
)

// Task type names. Match the queue names 1:1 here EXCEPT for
// wa:send_image which shares the wa:send queue (same downstream
// resource, same rate-limit budget).
const (
	TaskWASend        = "wa:send"
	TaskWASendImage   = "wa:send_image"
	TaskWAIncoming    = "wa:incoming"
	TaskWAReaction    = "wa:reaction"
	TaskWALidBackfill = "wa:lid_backfill"
	TaskAIReply       = "ai:reply"
	// Pre-render every fill state of a loyalty stamp card. Heavy but
	// infrequent (only on program design/layout change), so it gets its
	// own low-concurrency queue rather than competing with sends.
	TaskLoyaltyRenderCard = "loyalty:render_card"
)

// Client wraps asynq.Client for the producer side. Used by HTTP
// handlers + the inbound event router (JUR-68) to enqueue tasks.
type Client struct {
	*asynq.Client
	opt asynq.RedisConnOpt
}

func NewClient(redisURL string) (*Client, error) {
	opt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL for asynq: %w", err)
	}
	return &Client{
		Client: asynq.NewClient(opt),
		opt:    opt,
	}, nil
}

// Server wraps asynq.Server. Workers are registered via Mux() then
// the server is started with Run().
type Server struct {
	server *asynq.Server
	mux    *asynq.ServeMux
}

func NewServer(redisURL string) (*Server, error) {
	opt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL for asynq server: %w", err)
	}

	cfg := asynq.Config{
		// Total in-flight tasks across all queues. 5 is plenty for
		// the modest WA throughput we expect on a 2GB VPS — bump if
		// JUR-32 smoke shows queue lag.
		Concurrency: 5,

		// Queue weights — higher number = more workers pulled.
		// AI replies are slow (1-10s) so we cap them at 1 to keep
		// cost predictable. Send + incoming get 2 each. Reactions
		// are tiny (single upsert) so 1 is plenty.
		Queues: map[string]int{
			QueueWASend:        2,
			QueueWAIncoming:    2,
			QueueWAReaction:    1,
			QueueWALidBackfill: 1,
			QueueAIReply:       1,
			QueueLoyaltyRender: 1,
		},

		// Exponential backoff for retries: 5s, 25s, 125s, ... capped
		// at a sensible ceiling. Most transient errors recover in the
		// first retry.
		RetryDelayFunc: func(n int, e error, t *asynq.Task) time.Duration {
			d := 5 * time.Second
			for i := 0; i < n; i++ {
				d *= 5
				if d > 5*time.Minute {
					return 5 * time.Minute
				}
			}
			return d
		},

		// Surface every worker error to slog. Final-attempt detection
		// happens per-handler via asynq.GetRetryCount/GetMaxRetry.
		ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, t *asynq.Task, err error) {
			retried, _ := asynq.GetRetryCount(ctx)
			maxRetry, _ := asynq.GetMaxRetry(ctx)
			slog.Error("task failed",
				"type", t.Type(),
				"retry", retried,
				"max", maxRetry,
				"err", err,
			)
		}),
	}

	srv := asynq.NewServer(opt, cfg)
	mux := asynq.NewServeMux()

	return &Server{server: srv, mux: mux}, nil
}

// Mux exposes the inner ServeMux so callers (queue.Register*) can
// attach handlers before Run.
func (s *Server) Mux() *asynq.ServeMux {
	return s.mux
}

// Run starts the worker goroutines. Returns when the asynq server
// stops (which happens via Shutdown).
func (s *Server) Run() error {
	return s.server.Run(s.mux)
}

// Shutdown stops accepting new tasks and waits up to ctx deadline for
// in-flight workers to finish.
func (s *Server) Shutdown() {
	s.server.Shutdown()
}

// IsFinalAttempt reports whether the current task execution is the
// last one (i.e. the next failure is final). Use in handlers to
// branch into "mark as permanently failed" behaviour.
func IsFinalAttempt(ctx context.Context) bool {
	retried, ok1 := asynq.GetRetryCount(ctx)
	maxRetry, ok2 := asynq.GetMaxRetry(ctx)
	if !ok1 || !ok2 {
		return false
	}
	return retried >= maxRetry
}
