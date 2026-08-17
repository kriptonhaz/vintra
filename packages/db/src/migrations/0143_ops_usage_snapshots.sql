-- Platform usage snapshots for the Supabase free-tier watch.
--
-- Global ops table — deliberately NO tenant_id, same convention as the
-- master_* reference tables.
--
-- Supabase reports egress as `db_transmit_bytes`, a COUNTER that resets
-- whenever the instance restarts, so one reading tells you nothing. The rate
-- between two snapshots is the only usable signal, and that needs durable
-- history. It lives here rather than in a file so local runs and CI runs
-- append to the same series.
--
-- Written by scripts/check-supabase-usage.ts. Rows are tiny and written a few
-- times a day at most, so no retention policy is needed for a long time.
--
-- Hand-written (not drizzle-kit generated) to match every migration since
-- 0006: the meta snapshot history is corrupt at 0004/0005 (two byte-identical
-- snapshots collide) and `db:generate` has errored out since June 2026.
--
-- Additive + idempotent (IF NOT EXISTS) so it is safe to re-apply.

CREATE TABLE IF NOT EXISTS "ops_usage_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "db_size_bytes" bigint NOT NULL,
  "transmit_bytes" bigint NOT NULL,
  "auth_users" integer NOT NULL,
  "realtime_subscriptions" integer NOT NULL,
  "tenants" integer NOT NULL,
  "branches" integer NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ops_usage_snapshots_captured_at_idx"
  ON "ops_usage_snapshots" ("captured_at");
