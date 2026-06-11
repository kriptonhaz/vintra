-- Adds the Free-tier "main inventory branch" pointer. Free tier locks
-- inventory to one user-chosen branch out of the tenant's many; paid
-- tiers ignore this column entirely (unlimited branches).
--
-- Default value for existing rows: oldest active branch the tenant has.
-- This auto-picks something sensible for tenants who already had stock
-- balances at multiple branches under the leaky branch-cap behaviour
-- we just removed; they keep historical data, but new movements on
-- non-main branches will now be refused at the Free tier (paid tiers
-- are unaffected).
ALTER TABLE "inventory_settings"
  ADD COLUMN IF NOT EXISTS "main_branch_id" uuid
    REFERENCES "branches"("id") ON DELETE SET NULL;

UPDATE "inventory_settings" s
SET "main_branch_id" = b.id
FROM (
  SELECT DISTINCT ON (tenant_id) tenant_id, id
  FROM "branches"
  WHERE "is_active" = true
  ORDER BY tenant_id, "created_at" ASC
) b
WHERE s."tenant_id" = b.tenant_id
  AND s."main_branch_id" IS NULL;
