-- #216 follow-up: make a 01:00 WIB daily cutoff the universal stale
-- cash-session rule (previously elapsed_hours/14).
--
--   * Column default flips so every NEW tenant starts on the cutoff.
--   * Every EXISTING tenant is migrated to the cutoff too — this is a
--     deliberate product default change, not just a fallback. A tenant
--     (or branch) can still switch back to elapsed-hours in POS settings.
--
-- The per-branch override column (branches.cash_stale_config) is left
-- untouched: NULL there still means "inherit the tenant default", which
-- is now the 01:00 cutoff.

ALTER TABLE "pos_settings"
  ALTER COLUMN "cash_stale_config"
  SET DEFAULT '{"mode":"daily_cutoff","cutoff":"01:00"}'::jsonb;

UPDATE "pos_settings"
  SET cash_stale_config = '{"mode":"daily_cutoff","cutoff":"01:00"}'::jsonb;
