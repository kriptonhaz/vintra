-- "Cabang utama" flag on branches. Replaces the
-- inventory-scoped `inventory_settings.main_branch_id` concept with a
-- branch-owned boolean so the marker applies tenant-wide (POS default
-- branch picker, inventory tier-gating, future modules).
--
-- Backfill order matters:
--   1. Anything pointed to by `inventory_settings.main_branch_id` wins.
--   2. For tenants without that, the OLDEST branch becomes main
--      (matches the previous lazy auto-pick in ensureMainBranchId).
--   3. Single-branch tenants: that branch is main.
--
-- Uniqueness enforced by partial unique index — at most one row per
-- tenant with is_main = true. App code flips others to false in the
-- same transaction when a new main is chosen.

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "is_main" boolean NOT NULL DEFAULT false;

-- Backfill from existing inventory_settings.main_branch_id (set true on
-- the row referenced; everything else stays false).
UPDATE "branches" AS b
SET "is_main" = true
FROM "inventory_settings" AS s
WHERE s."main_branch_id" = b."id"
  AND s."tenant_id" = b."tenant_id";

-- Backfill for tenants where inventory_settings has no main_branch_id
-- yet: pick the oldest active branch.
WITH oldest AS (
  SELECT DISTINCT ON (tenant_id)
    id,
    tenant_id
  FROM "branches"
  WHERE "is_active" = true
  ORDER BY tenant_id, "created_at" ASC
)
UPDATE "branches" AS b
SET "is_main" = true
FROM oldest o
WHERE b.id = o.id
  AND NOT EXISTS (
    SELECT 1 FROM "branches" b2
    WHERE b2."tenant_id" = b."tenant_id" AND b2."is_main" = true
  );

-- Partial unique: at most one main per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "branches_tenant_main_unique"
  ON "branches" ("tenant_id")
  WHERE "is_main" = true;
