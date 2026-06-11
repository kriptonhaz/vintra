-- Multi-product + category promo support. Replaces the single
-- tenant_promotions.product_id column with a promotion_targets join
-- table that can hold many items, many categories, or both. The
-- trigger_type CHECK is widened with 'auto_products' (multi-product)
-- and 'auto_category'. The legacy 'auto_product' value is kept so the
-- existing row stays valid; new rows use 'auto_products' uniformly
-- (single vs multi is a UI distinction only).

-- 1. Join table.
CREATE TABLE "promotion_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "promotion_id" uuid NOT NULL REFERENCES "tenant_promotions"("id") ON DELETE CASCADE,
  "item_id" uuid REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "category_id" uuid REFERENCES "tenant_categories"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "promotion_targets_xor_chk" CHECK ((item_id IS NOT NULL) <> (category_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_targets_promo_item_uniq" ON "promotion_targets" ("promotion_id", "item_id") WHERE "item_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_targets_promo_category_uniq" ON "promotion_targets" ("promotion_id", "category_id") WHERE "category_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "promotion_targets_item_idx" ON "promotion_targets" ("item_id") WHERE "item_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "promotion_targets_category_idx" ON "promotion_targets" ("category_id") WHERE "category_id" IS NOT NULL;
--> statement-breakpoint

-- 2. Backfill existing auto_product rows (1 row in prod at write time —
-- "Promo B1G1" → Roti Canai Coklat) into the join table so cashier
-- matching can be unified on promotion_targets.
INSERT INTO "promotion_targets" ("tenant_id", "promotion_id", "item_id", "category_id")
SELECT "tenant_id", "id", "product_id", NULL
FROM "tenant_promotions"
WHERE "trigger_type" = 'auto_product' AND "product_id" IS NOT NULL;
--> statement-breakpoint

-- 3. Drop the old composite CHECK (it references product_id).
ALTER TABLE "tenant_promotions" DROP CONSTRAINT IF EXISTS "tenant_promotions_trigger_chk";
--> statement-breakpoint

-- 4. Drop the legacy column.
ALTER TABLE "tenant_promotions" DROP COLUMN IF EXISTS "product_id";
--> statement-breakpoint

-- 5. New CHECK covering every trigger type. Target presence is
-- enforced at the application layer (upsertPromotion validator) since
-- it lives in a separate table.
ALTER TABLE "tenant_promotions" ADD CONSTRAINT "tenant_promotions_trigger_chk" CHECK (
  ("trigger_type" = 'code' AND "code" IS NOT NULL) OR
  ("trigger_type" = 'auto_product' AND "code" IS NULL) OR
  ("trigger_type" = 'auto_products' AND "code" IS NULL) OR
  ("trigger_type" = 'auto_category' AND "code" IS NULL) OR
  ("trigger_type" = 'auto_cart' AND "code" IS NULL)
);
