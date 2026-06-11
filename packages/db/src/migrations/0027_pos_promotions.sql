-- JUR-9: Tenant promotions (codes + product auto-apply + cart auto-apply).
--
-- Single table covers all three trigger modes — saves us from the v2
-- "merge promo_codes + product_promos" refactor we'd otherwise hit.
-- The `trigger_type` discriminator + a CHECK constraint ensures every
-- row commits to exactly one mode (code = customer-typed code,
-- auto_product = applies when product enters cart, auto_cart =
-- cart-wide auto-apply like happy hour).
--
-- Code promos snapshot to pos_sales.{promo_code_snapshot, promo_amount}.
-- Auto-product promos materialise per-line on pos_sale_items
-- ({auto_promo_id, auto_promo_amount}) — distinct from JUR-7's
-- line_discount_* columns so future reports can split owner-set promos
-- from cashier-applied manual discounts.

CREATE TABLE "tenant_promotions" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"                 text NOT NULL,
  "code"                 text,
  "trigger_type"         text NOT NULL,
  "product_id"           uuid REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "discount_type"        text NOT NULL,
  "discount_value"       numeric(15, 2) NOT NULL,
  "max_discount_amount"  numeric(15, 2),
  "min_cart_total"       numeric(15, 2),
  "starts_at"            timestamp,
  "ends_at"              timestamp,
  "total_redemption_cap" integer,
  "per_customer_cap"     integer,
  "is_active"            boolean NOT NULL DEFAULT true,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  "updated_at"           timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_promotions_trigger_chk" CHECK (
    ("trigger_type" = 'code'         AND "code" IS NOT NULL  AND "product_id" IS NULL) OR
    ("trigger_type" = 'auto_product' AND "code" IS NULL      AND "product_id" IS NOT NULL) OR
    ("trigger_type" = 'auto_cart'    AND "code" IS NULL      AND "product_id" IS NULL)
  ),
  CONSTRAINT "tenant_promotions_discount_type_chk" CHECK (
    "discount_type" IN ('percent', 'fixed')
  )
);
--> statement-breakpoint

-- Partial unique index: only enforces uniqueness on (tenant_id, code)
-- when code is set. Auto-applied rows have NULL code and don't collide.
CREATE UNIQUE INDEX "tenant_promotions_tenant_code_unique"
  ON "tenant_promotions" ("tenant_id", "code")
  WHERE "code" IS NOT NULL;
--> statement-breakpoint

-- Hot path: cashier add-to-cart needs to find auto_product promos for
-- a given product within the active window. Single composite index
-- covers both the trigger filter and the date check.
CREATE INDEX "tenant_promotions_active_product_idx"
  ON "tenant_promotions" ("tenant_id", "product_id")
  WHERE "trigger_type" = 'auto_product' AND "is_active" = true;
--> statement-breakpoint

-- Redemption ledger. Mirrors the loyalty movements pattern: every
-- code application + auto-applied lift writes one row, sum-able for
-- the per-tenant + per-customer caps. amount is the Rp value of the
-- discount actually applied (after max_discount_amount cap, etc).
CREATE TABLE "promo_redemptions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "promo_id"     uuid NOT NULL REFERENCES "tenant_promotions"("id") ON DELETE CASCADE,
  "sale_id"      uuid REFERENCES "pos_sales"("id"),
  "customer_id"  uuid REFERENCES "customers"("id"),
  "amount"       numeric(15, 2) NOT NULL,
  "created_at"   timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX "promo_redemptions_promo_idx"
  ON "promo_redemptions" ("promo_id", "created_at");
--> statement-breakpoint

CREATE INDEX "promo_redemptions_customer_idx"
  ON "promo_redemptions" ("customer_id", "promo_id")
  WHERE "customer_id" IS NOT NULL;
--> statement-breakpoint

-- Sale-level snapshot for code + auto_cart promos.
ALTER TABLE "pos_sales"
  ADD COLUMN "promo_code_snapshot" text,
  ADD COLUMN "promo_amount"        numeric(15, 2);
--> statement-breakpoint

-- Per-line snapshot for auto_product promos. Kept separate from
-- JUR-7's line_discount_* so reports can split "cashier discount"
-- (manual) from "auto-applied promo" (owner-configured).
ALTER TABLE "pos_sale_items"
  ADD COLUMN "auto_promo_id"     uuid REFERENCES "tenant_promotions"("id"),
  ADD COLUMN "auto_promo_amount" numeric(15, 2) NOT NULL DEFAULT 0;
