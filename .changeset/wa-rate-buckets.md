---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add per-instance + per-JID rate buckets to the WhatsApp send worker.

WhatsApp permanently bans accounts that send too fast — and the ban
is irrecoverable on that number. Without throttling, a runaway script
or accidental loop sending to one customer can kill a paying tenant's
phone line forever.

The new `internal/ratelimit` package implements an atomic two-level
token bucket via Redis Lua:

- **Per-instance** (default 10/sec): account-wide cap so one tenant's
  bursts don't take their own number down.
- **Per-JID** (default 1/sec): per-recipient cap so the same customer
  can't be flooded.

Both buckets must allow the send. The Lua script consumes from both
atomically — never partially — so concurrent workers can't game it.

Wired into the `wa:send` asynq worker. When the bucket can't allow
the send within `WA_RATE_MAX_WAIT_MS` (default 5s), the task returns
`ErrRateLimited` and asynq retries with its own exponential backoff —
which spaces out the next attempt naturally.

Configurable via env: `WA_RATE_PER_INSTANCE_PER_SEC`, `WA_RATE_PER_JID_PER_SEC`,
`WA_RATE_BUCKET_CAPACITY`, `WA_RATE_MAX_WAIT_MS`. Setting either rate
to 0 disables that level.

Tests cover throttling, max-wait timeout, JID isolation, and disabled
buckets. Closes JUR-43.
