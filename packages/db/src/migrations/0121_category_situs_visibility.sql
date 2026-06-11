-- Per-category situs visibility. Default true preserves existing behavior
-- (all categories show on the public storefront). Tenants on Komplit can
-- untick this for non-menu categories like "Bungkus" / packaging so those
-- SKUs stay ringable at POS but disappear from q/<slug>.
ALTER TABLE "tenant_categories"
  ADD COLUMN "is_visible_on_situs" boolean NOT NULL DEFAULT true;
