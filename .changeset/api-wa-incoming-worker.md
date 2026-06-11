---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

wa-incoming worker + Redis dedupe + contact upsert (JUR-68, closes M2 code work).

Inbound pipeline: whatsmeow Message event → Registry hot-path filter → Redis SADD dedupe → asynq enqueue → worker → wa_messages insert + wa_contacts upsert.

- **`internal/whatsapp/registry.go`** — `Registry` now takes `*goredis.Client` + `*asynq.Client` at construction so the new `inboundSubscriber` can do dedupe + enqueue without any DB I/O on the whatsmeow event hot path. Filters in order: `IsFromMe`, `status@broadcast`, `@g.us` (groups), `@newsletter`. Empty external IDs are dropped with a warning. Redis SADD adds to `wa:seen:{instanceId}` with a rolling 5-min TTL — fails OPEN on Redis errors (better to insert a duplicate than drop a real message; the worker's ON CONFLICT DO NOTHING handles it). `extractMessageContent` pulls text from `Conversation`/`ExtendedTextMessage` and falls back to type-only persistence for image/video/document/audio/sticker (richer media in JUR-45).
- **`internal/whatsapp/registry.go`** — new `lookupTenantID(ctx, instanceID)` helper that uses a new sqlc query `GetInstanceTenantID` (bypasses tenant scoping — used by registry only to package the tenant_id into the inbound payload, never by HTTP callers).
- **`internal/db/queries/wa_instances.sql`** — added `GetInstanceTenantID` (`SELECT tenant_id FROM wa_instances WHERE id = $1`). Generated code includes the new method on the Querier interface.
- **`internal/queue/tasks/wa_incoming.go`** — handler unmarshals `InboundPayload`, inserts via `CreateInboundMessage`, upserts via `UpsertWaContact`. Returns `asynq.SkipRetry` for bad payloads + UUID parse errors. TODO comment for the M3 `ai:reply` enqueue hook.
- **`cmd/api/main.go`** — reordered: asynq client/server constructed BEFORE registry (which now needs them); registers both `wa:send` and `wa:incoming` task handlers on the mux before `Run`.

Boot smoke verified: `postgres connected → redis connected → asynq client ready → api listening → asynq server starting → registry revive: no instances to attach` — clean lifecycle with all 4 subsystems wired.

The actual end-to-end inbound message flow (real phone sends message → row appears in wa_messages within 1s, no duplicates after reconnect, groups not persisted) is gated on JUR-32 manual e2e.

`go vet` clean, 40 tests pass across 13 packages.
