-- POS module Phase 1 (Free + Toko). Adds:
--   1. pos_settings — per-tenant subscription/trial state + receipt
--      customisation + tax + allowed payment methods.
--   2. pos_sales — sale header (one row per transaction).
--   3. pos_sale_items — sale lines, optional FK to inventory_items
--      (null for ad-hoc lines).
--   4. pos_sale_counters — atomic per-tenant counter for sale_number.
--
-- inventory_movements already has reference_type + reference_id
-- columns (no enum constraint), so no inventory-side migration needed
-- — the recordMovement server function gets a small input-validator
-- widening to accept those args from the caller.

-- ── pos_settings ─────────────────────────────────────────────────
CREATE TABLE "pos_settings" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid NOT NULL UNIQUE
                                  REFERENCES "tenants"("id") ON DELETE CASCADE,
  "tier"                     text NOT NULL DEFAULT 'free',
  "subscription_active"      boolean NOT NULL DEFAULT false,
  "subscription_started_at"  timestamp,
  "subscription_expires_at"  timestamp,
  "trial_started_at"         timestamp,
  "trial_ends_at"            timestamp,
  "trial_used"               boolean NOT NULL DEFAULT false,
  "receipt_logo_key"         text,
  "receipt_footer_text"      text,
  "tax_enabled"              boolean NOT NULL DEFAULT false,
  "tax_percent"              numeric(5, 2) NOT NULL DEFAULT 0,
  "tax_label"                text DEFAULT 'PPN',
  "default_payment_methods"  text[] NOT NULL DEFAULT ARRAY['cash', 'qris']::text[],
  "created_at"               timestamp NOT NULL DEFAULT now(),
  "updated_at"               timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "pos_tier_chk"
    CHECK ("tier" IN ('free', 'toko', 'bisnis', 'multi_outlet'))
);

-- ── pos_sales ────────────────────────────────────────────────────
CREATE TABLE "pos_sales" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "branch_id"        uuid NOT NULL REFERENCES "branches"("id"),
  "sale_number"      text NOT NULL,
  "cashier_user_id"  uuid NOT NULL,
  "customer_name"    text,
  "customer_phone"   text,
  "subtotal"         numeric(15, 2) NOT NULL,
  "discount_type"    text,
  "discount_value"   numeric(15, 2),
  "discount_amount"  numeric(15, 2) NOT NULL DEFAULT 0,
  "tax_amount"       numeric(15, 2) NOT NULL DEFAULT 0,
  "total"            numeric(15, 2) NOT NULL,
  "payment_method"   text NOT NULL,
  "paid_amount"      numeric(15, 2) NOT NULL,
  "change_amount"    numeric(15, 2) NOT NULL DEFAULT 0,
  "status"           text NOT NULL DEFAULT 'completed',
  "void_reason"      text,
  "voided_at"        timestamp,
  "voided_by"        uuid,
  "notes"            text,
  "created_at"       timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "pos_sales_tenant_number_unique"
    UNIQUE ("tenant_id", "sale_number"),
  CONSTRAINT "pos_sales_status_chk"
    CHECK ("status" IN ('completed', 'voided')),
  CONSTRAINT "pos_sales_payment_chk"
    CHECK ("payment_method" IN ('cash', 'qris', 'transfer', 'card', 'ewallet')),
  CONSTRAINT "pos_sales_discount_chk"
    CHECK ("discount_type" IS NULL OR "discount_type" IN ('fixed', 'percent'))
);

CREATE INDEX "pos_sales_branch_day_idx"
  ON "pos_sales" ("branch_id", "created_at");
CREATE INDEX "pos_sales_tenant_day_idx"
  ON "pos_sales" ("tenant_id", "created_at");

-- ── pos_sale_items ───────────────────────────────────────────────
CREATE TABLE "pos_sale_items" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sale_id"        uuid NOT NULL REFERENCES "pos_sales"("id") ON DELETE CASCADE,
  "item_id"        uuid REFERENCES "inventory_items"("id"),
  "name_snapshot"  text NOT NULL,
  "sku_snapshot"   text,
  "qty"            numeric(15, 4) NOT NULL,
  "unit_price"     numeric(15, 2) NOT NULL,
  "subtotal"       numeric(15, 2) NOT NULL,
  "hpp_at_sale"    numeric(15, 2),
  "is_adhoc"       boolean NOT NULL DEFAULT false,
  "created_at"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "pos_sale_items_sale_idx"
  ON "pos_sale_items" ("sale_id");
CREATE INDEX "pos_sale_items_item_idx"
  ON "pos_sale_items" ("item_id")
  WHERE "item_id" IS NOT NULL;

-- ── pos_sale_counters ────────────────────────────────────────────
CREATE TABLE "pos_sale_counters" (
  "tenant_id"  uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "year"       integer NOT NULL,
  "next_seq"   integer NOT NULL DEFAULT 1
);
