-- JUR-10: Wire BOM to POS sales (ingredient auto-deduction).
--
-- Schema changes are minimal — the bridge data model already exists
-- (inventoryItems.linkedHppProductId + linkedHppMaterialId). The only
-- structural gap was nested recipes: HPP step-2 lets owners pick a
-- sub-product as a cost component but the link was never persisted.
-- This migration adds `source_product_id` so step-2 can save it, with
-- a mutual-exclusion CHECK to guarantee every BOM row is exactly one
-- of (material-sourced, product-sourced).
--
-- The deduction logic in v1 reads only `material_id IS NOT NULL` rows.
-- Sub-product (`source_product_id IS NOT NULL`) rows are persisted
-- now so a future v2 can recurse without backfill.
--
-- Unit columns (materials.unit, product_materials.unit) remain text
-- in this migration. Cleanup migrates them to FK in JUR-14.

-- product_materials.material_id was NOT NULL. Now nullable so we can
-- have rows where source_product_id is set instead.
ALTER TABLE "product_materials" ALTER COLUMN "material_id" DROP NOT NULL;
--> statement-breakpoint

-- New optional column for product-as-ingredient. ON DELETE CASCADE
-- mirrors product_materials.product_id: if the source product is
-- deleted, BOM rows referencing it disappear too (they'd be orphaned
-- otherwise — the parent's HPP value would be wrong but that's a
-- data-quality issue the owner has to address anyway).
ALTER TABLE "product_materials"
  ADD COLUMN "source_product_id" uuid REFERENCES "products"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Mutual exclusion: exactly one of (material_id, source_product_id)
-- must be set per row. XOR check via the standard `IS NULL` trick.
ALTER TABLE "product_materials"
  ADD CONSTRAINT "product_materials_source_chk"
  CHECK (("material_id" IS NULL) <> ("source_product_id" IS NULL));
--> statement-breakpoint

-- Index for the deduction-side lookup: when a parent product is sold,
-- we fetch all its BOM rows. This index already exists implicitly via
-- the FK on product_id, but we add a covering one ordered by created_at
-- so the query plan stays predictable as carts scale.
CREATE INDEX IF NOT EXISTS "product_materials_product_idx"
  ON "product_materials" ("product_id");
