---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

asynq queues + wa-send worker + message endpoints (JUR-67, M2).

The outbound message pipeline: HTTP → asynq queue → worker → whatsmeow → real WhatsApp.

- **`internal/queue/queue.go`** — `Client` (producer) + `Server` (worker host) thin wrappers around `hibiken/asynq`. 3 named queues with weight-based priority (`wa:send` × 2, `wa:incoming` × 2, `ai:reply` × 1) — total 5 concurrent in-flight tasks across the process to keep RAM in check on a 2 GB VPS. Custom `RetryDelayFunc` does 5s → 25s → 125s → ... capped at 5min. Global `ErrorHandler` logs every worker failure with retry count via slog. `IsFinalAttempt(ctx)` helper exposed so handlers can branch into "mark row failed" on the last try.
- **`internal/queue/tasks/wa_send.go`** — task type `wa:send` with `WASendPayload{MessageID}`. Handler loads the row, gets the live Connection from the registry, calls `SendText`, marks `sent` + `external_id` on success. Idempotency: if row is already `sent` (duplicate enqueue / DLQ replay), no-op. `asynq.SkipRetry` for bad payloads + bad JIDs (retrying won't help). `pgx.ErrNoRows` for a deleted row is also terminal. Final-attempt failures flip the row to `failed` with `error_message` (truncated to 500 chars) via the `IsFinalAttempt` check.
- **`internal/whatsapp/jid.go`** — `NormalizeJID` converts user-typed phone numbers to WhatsApp JIDs (`628...@s.whatsapp.net`). Handles `+62…`, `08…` (leading 0 → 62), separators (spaces, dashes, parens). 13 test cases covering happy paths + length/character validation.
- **`internal/db/queries/wa_messages.sql`** — 6 new sqlc queries: `CreateOutboundMessage`, `GetWaMessage`, `MarkMessageSent`, `MarkMessageFailed`, `ListMessagesForConversation`, `CreateInboundMessage` (used by JUR-68 next), `UpsertWaContact` (also JUR-68).
- **`internal/http/handlers/wa_messages.go`** — `POST /v1/wa/instances/:id/messages` (insert pending row → enqueue → 202 Accepted with the row) and `GET /v1/wa/instances/:id/messages?jid=…&limit=50` (conversation tail). Enqueue uses a fresh 5s `context.Background` so client disconnects don't orphan tasks; if enqueue fails the row is marked `failed` inline.
- **`internal/http/server.go`** — Deps gains `*queue.Client`, 2 new routes wired.
- **`cmd/api/main.go`** — Constructs asynq Client + Server, registers the `wa:send` handler before starting workers. Shutdown order is now HTTP → asynq → registry: HTTP stops new requests, asynq drains in-flight workers (which may still need the registry), then registry closes sockets.

Smoke verified after a route-wiring fix (Edit tool failures had left server.go without the message routes — caught by a 404 on POST instead of expected 401):
- POST /v1/wa/instances/abc/messages no auth → 401
- GET /v1/wa/instances/abc/messages?jid=x no auth → 401
- /v1/unknown → 404 (per-route MW correctly doesn't catch unmatched paths)
- Boot: postgres connected ✓ redis connected ✓ asynq client ready ✓ asynq server starting ✓ registry revive ✓

`go vet` clean. 40 tests pass across 13 packages (24 in whatsapp package alone now, mostly JID parsing).
