import { pgTable, uuid, bigint, integer, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Platform usage snapshots — a global ops table, so deliberately NO
 * `tenant_id` (same convention as the master-data tables).
 *
 * Written by `scripts/check-supabase-usage.ts`. Supabase exposes egress as
 * `db_transmit_bytes`, a COUNTER that resets whenever the instance restarts,
 * so a single reading is meaningless — the rate between two snapshots is the
 * only usable signal. This table is that history, and it lives in the database
 * rather than a file so local runs and CI runs share one series.
 *
 * Rows are tiny and written at most a few times a day; no retention policy is
 * needed for a long time.
 */
export const opsUsageSnapshots = pgTable(
  'ops_usage_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** `pg_database_size_bytes{datname="postgres"}` — counts against the 500 MB free-tier cap. */
    dbSizeBytes: bigint('db_size_bytes', { mode: 'number' }).notNull(),
    /** `db_transmit_bytes` — cumulative egress counter, resets on instance restart. */
    transmitBytes: bigint('transmit_bytes', { mode: 'number' }).notNull(),
    /** `auth_users_user_count` — against the 50k MAU cap. */
    authUsers: integer('auth_users').notNull(),
    /**
     * `realtime_postgres_changes_total_subscriptions`. Expected to stay 0 after
     * migration 0142 tore the Realtime setup down. Anything above 0 means
     * something re-subscribed — the exact pattern that exhausted JuraganQu's
     * egress — so it is tracked as a regression tripwire, not for capacity.
     */
    realtimeSubscriptions: integer('realtime_subscriptions').notNull(),
    tenants: integer('tenants').notNull(),
    branches: integer('branches').notNull(),
  },
  (t) => [index('ops_usage_snapshots_captured_at_idx').on(t.capturedAt)],
)
