-- Per-tenant referral allowlist + cap.
--
-- The referral program moves from "every tenant can run one" to a
-- curated allowlist. A tenant can create codes / view pendaftar /
-- claim commissions only if it has a row here with enabled = true.
-- `cap_pct` overrides the global `referral_global_config.cap_pct`
-- for that tenant (the discountPct + commissionPct on each code must
-- sum to <= cap_pct).
--
-- No row = no access. Being *referred* (signing up with someone
-- else's code) is unaffected — that path never reads this table.
--
-- Rollback: DROP TABLE "tenant_referral_settings";

CREATE TABLE IF NOT EXISTS "tenant_referral_settings" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"  uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "enabled"    boolean NOT NULL DEFAULT true,
  "cap_pct"    numeric(5, 2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed the initial allowlist. Mantra Maker + DigitalContent are the
-- two tenants with existing referral codes (audited 2026-05-19).
-- Es Teh Paus will be configured manually via the admin UI.
-- Only insert rows whose tenant exists, so this migration also runs
-- on fresh environments that don't have these tenants.
INSERT INTO "tenant_referral_settings" ("tenant_id", "enabled", "cap_pct")
SELECT v.tenant_id, v.enabled, v.cap_pct
FROM (
  VALUES
    ('59a3460a-e750-4e7a-9b51-e3e230f0e821'::uuid, true, 20.00),  -- Mantra Maker
    ('89791a85-7316-4b86-bbc9-eb65efc4e22a'::uuid, true, 20.00)   -- DigitalContent
) AS v(tenant_id, enabled, cap_pct)
WHERE EXISTS (SELECT 1 FROM "tenants" t WHERE t.id = v.tenant_id)
ON CONFLICT ("tenant_id") DO NOTHING;
