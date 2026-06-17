-- Global default cap for the internal marketing commission program.
-- Separate from referral_global_config.cap_pct (which governs the
-- tenant-to-tenant referral cap, currently 20%). Default 10% applies to
-- every marketing head/staff unless an admin overrides a head's cap_pct.
ALTER TABLE "referral_global_config"
  ADD COLUMN IF NOT EXISTS "marketing_cap_pct" numeric(5, 2) NOT NULL DEFAULT '10.00';
