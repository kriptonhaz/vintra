-- #216: configurable stale cash-session threshold.
--
-- `pos_settings.cash_stale_config` is the tenant default; its default
-- value reproduces the pre-#216 hardcoded `opened > 14h` rule so no
-- existing tenant changes behavior until they opt into a daily cutoff.
--
-- `branches.cash_stale_config` is a nullable per-branch override —
-- NULL means "inherit the tenant default". Multi-outlet tenants use it
-- to give, say, a 24h outlet a different cutoff than an 08:00–22:00 one.
--
-- Shape (CashStaleConfig in schema/pos.ts):
--   {"mode":"elapsed_hours","hours":14}
--   {"mode":"daily_cutoff","cutoff":"01:00","minHours":4}
--
-- Idempotent (IF NOT EXISTS) in case it was applied out-of-band before
-- the migrator caught up.

ALTER TABLE "pos_settings"
  ADD COLUMN IF NOT EXISTS "cash_stale_config" jsonb NOT NULL
  DEFAULT '{"mode":"elapsed_hours","hours":14}'::jsonb;

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "cash_stale_config" jsonb;
