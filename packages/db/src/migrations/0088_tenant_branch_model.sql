-- Add tenants.branch_model + tenants.situs_mode.
--
-- branch_model — 'independent' (multi-outlet, one owner) vs 'franchise'
-- (each branch is a paid outlet, staff hard-scoped, HQ sees all). Drives
-- UI affordances around the branch switcher; data isolation itself stays
-- enforced by tenant_member_branches.
--
-- situs_mode — 'single' (one tenant-wide public site, booking widget
-- picks the outlet) vs 'per_branch' (each branch publishes its own site).
--
-- Both NOT NULL with a constant default, so every pre-existing tenant is
-- filled in instantly by Postgres with zero data change.
--
-- Rollback:
--   ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_branch_model_chk";
--   ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_situs_mode_chk";
--   ALTER TABLE "tenants" DROP COLUMN IF EXISTS "branch_model";
--   ALTER TABLE "tenants" DROP COLUMN IF EXISTS "situs_mode";

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "branch_model" text DEFAULT 'independent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "situs_mode" text DEFAULT 'single' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_branch_model_chk" CHECK ("branch_model" IN ('independent', 'franchise'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_situs_mode_chk" CHECK ("situs_mode" IN ('single', 'per_branch'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
