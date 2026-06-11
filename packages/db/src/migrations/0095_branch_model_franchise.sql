-- Franchise / Independent — Phase A foundation.
--
-- The branch model is chosen PER BRANCH (one tenant can have a mix of
-- franchise and independent outlets), so branch_model moves off the
-- tenants table — where migration 0088 wrongly put it — onto branches.
-- 0088's column was inert (nothing read it), so the move is a clean
-- drop + add. `tenants.situs_mode` stays put.
--
-- Also adds inventory_items.franchise_price — the price HQ charges a
-- franchise branch for an item via the requisition (NULL = not offered
-- to franchises).
--
-- Rollback:
--   ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "franchise_price";
--   ALTER TABLE "branches" DROP COLUMN IF EXISTS "branch_model";
--   ALTER TABLE "tenants" ADD COLUMN "branch_model" text DEFAULT 'independent' NOT NULL;

ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_branch_model_chk";
--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "branch_model";
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "branch_model" text DEFAULT 'independent' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "branches" ADD CONSTRAINT "branches_branch_model_chk" CHECK ("branch_model" IN ('independent', 'franchise'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "franchise_price" numeric(15, 2);
