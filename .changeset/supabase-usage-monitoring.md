---
"@vintra/db": minor
---

Add a Supabase free-tier usage watch, so the self-hosting decision surfaces on
its own instead of depending on someone remembering to open the dashboard.

`scripts/check-supabase-usage.ts` reports database size, projected 30-day
egress, and auth users against the free-tier limits, warning at 70% of each.
Run it locally with `bun run check:usage` (`--dry` to report without recording);
a daily GitHub Actions workflow runs it too and fails the job when a threshold
trips.

Egress is only obtainable from the Supabase Metrics API — the Management API
has no usage endpoint, it is dashboard-only. That metric, `db_transmit_bytes`,
is a counter that resets on instance restart, so a single reading is
meaningless. The new `ops_usage_snapshots` table (a global ops table, no
`tenant_id`) stores the history the rate is derived from, and a counter that
goes backwards is treated as a restart rather than reported as negative egress.

The check also tracks `realtime_postgres_changes_total_subscriptions`, which
should stay 0 after the migration 0142 teardown. Anything above 0 means
something re-subscribed to `postgres_changes` — the pattern that exhausted
JuraganQu's egress — so it is flagged as a regression tripwire.
