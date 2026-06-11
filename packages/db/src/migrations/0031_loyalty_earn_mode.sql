-- Loyalty earn modes: linear (today's behaviour) + per_step.
--
-- The linear model — N points per Rp spent, configured via
-- `loyalty_earn_rate` — is what every existing tenant uses. A new
-- per_step model lets a tenant say "earn 750 pts for every full
-- Rp 15.000 spent" (real ask: tenants who stamp loyalty cards,
-- jamu vendors with fixed token rewards).
--
-- Math at sale time:
--   linear   → floor(taxBase × loyalty_earn_rate)
--   per_step → floor(taxBase / loyalty_earn_step_amount)
--              × loyalty_earn_step_points
--
-- Mode column defaults to 'linear' so every existing tenant keeps
-- their current behaviour. The two step columns default to 0 — the
-- per_step math no-ops while step_amount = 0, so a tenant can flip
-- the mode and configure values without a transient broken state.
ALTER TABLE "pos_settings"
  ADD COLUMN IF NOT EXISTS "loyalty_earn_mode" text NOT NULL DEFAULT 'linear',
  ADD COLUMN IF NOT EXISTS "loyalty_earn_step_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "loyalty_earn_step_points" numeric(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE "pos_settings"
  DROP CONSTRAINT IF EXISTS "pos_loyalty_earn_mode_chk";

ALTER TABLE "pos_settings"
  ADD CONSTRAINT "pos_loyalty_earn_mode_chk"
  CHECK ("loyalty_earn_mode" IN ('linear', 'per_step'));
