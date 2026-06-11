-- Inventory module Phase 1 (Free + Toko). Adds:
--   1. inventory_settings — per-tenant subscription/trial state.
--   2. inventory_items — the catalogue (optional FK to HPP material/product).
--   3. inventory_stock_balances — running balance per (item, branch).
--   4. inventory_movements — append-only ledger of every stock change.
--   5. inventory_unit_conversions — alternate units (Toko+).
--   6. purchase_orders + purchase_order_items + purchase_order_counters
--      (Toko+, but schema lives here so single-PR migration).

-- ── inventory_settings ────────────────────────────────────────────
CREATE TABLE "inventory_settings" (
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
  "low_stock_alerts_enabled" boolean NOT NULL DEFAULT true,
  "created_at"               timestamp NOT NULL DEFAULT now(),
  "updated_at"               timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_tier_chk"
    CHECK ("tier" IN ('free', 'toko', 'bisnis', 'multi_outlet'))
);

-- ── inventory_items ──────────────────────────────────────────────
CREATE TABLE "inventory_items" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sku"                     text,
  "name"                    text NOT NULL,
  "category_id"             uuid REFERENCES "tenant_categories"("id") ON DELETE SET NULL,
  "base_unit_id"            uuid NOT NULL REFERENCES "master_hpp_units"("id"),
  "cost_price"              numeric(15, 2) NOT NULL DEFAULT 0,
  "selling_price"           numeric(15, 2),
  "min_stock_level"         numeric(15, 4),
  "photo_key"               text,
  "notes"                   text,
  "linked_hpp_material_id"  uuid REFERENCES "materials"("id") ON DELETE SET NULL,
  "linked_hpp_product_id"   uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "is_active"               boolean NOT NULL DEFAULT true,
  "created_at"              timestamp NOT NULL DEFAULT now(),
  "updated_at"              timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "inventory_items_tenant_active_idx"
  ON "inventory_items" ("tenant_id", "is_active");

-- SKU is unique per tenant when set; null SKUs don't conflict.
CREATE UNIQUE INDEX "inventory_items_tenant_sku_idx"
  ON "inventory_items" ("tenant_id", "sku")
  WHERE "sku" IS NOT NULL;

-- ── inventory_stock_balances ─────────────────────────────────────
CREATE TABLE "inventory_stock_balances" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "item_id"             uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "branch_id"           uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "quantity"            numeric(15, 4) NOT NULL DEFAULT 0,
  "last_movement_at"    timestamp,
  "created_at"          timestamp NOT NULL DEFAULT now(),
  "updated_at"          timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_stock_balances_item_branch_unique"
    UNIQUE ("item_id", "branch_id")
);

-- ── inventory_movements ──────────────────────────────────────────
CREATE TABLE "inventory_movements" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "item_id"        uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "branch_id"      uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "movement_type"  text NOT NULL,
  "quantity"       numeric(15, 4) NOT NULL,
  "unit_cost"      numeric(15, 2),
  "reason"         text,
  "reference_type" text,
  "reference_id"   uuid,
  "notes"          text,
  "performed_by"   uuid NOT NULL,
  "created_at"     timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_movements_type_chk"
    CHECK ("movement_type" IN ('in', 'out', 'adjustment', 'transfer_in', 'transfer_out'))
);

CREATE INDEX "inventory_movements_item_idx"
  ON "inventory_movements" ("item_id", "created_at");
CREATE INDEX "inventory_movements_tenant_created_idx"
  ON "inventory_movements" ("tenant_id", "created_at");

-- ── inventory_unit_conversions ───────────────────────────────────
CREATE TABLE "inventory_unit_conversions" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "item_id"          uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "alt_unit_id"      uuid NOT NULL REFERENCES "master_hpp_units"("id"),
  "ratio_to_base"    numeric(15, 4) NOT NULL,
  "created_at"       timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_unit_conversions_item_unit_unique"
    UNIQUE ("item_id", "alt_unit_id")
);

-- ── purchase_orders ──────────────────────────────────────────────
CREATE TABLE "purchase_orders" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "po_number"      text NOT NULL,
  "supplier_id"    uuid NOT NULL REFERENCES "suppliers"("id"),
  "branch_id"      uuid NOT NULL REFERENCES "branches"("id"),
  "status"         text NOT NULL DEFAULT 'draft',
  "expected_at"    date,
  "subtotal"       numeric(15, 2) NOT NULL DEFAULT 0,
  "notes"          text,
  "created_by"     uuid NOT NULL,
  "received_at"    timestamp,
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "updated_at"     timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_orders_tenant_number_unique"
    UNIQUE ("tenant_id", "po_number"),
  CONSTRAINT "purchase_orders_status_chk"
    CHECK ("status" IN ('draft', 'sent', 'partial', 'received', 'cancelled'))
);

CREATE INDEX "purchase_orders_tenant_status_idx"
  ON "purchase_orders" ("tenant_id", "status");

CREATE TABLE "purchase_order_items" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "item_id"           uuid NOT NULL REFERENCES "inventory_items"("id"),
  "ordered_qty"       numeric(15, 4) NOT NULL,
  "received_qty"      numeric(15, 4) NOT NULL DEFAULT 0,
  "unit_cost"         numeric(15, 2) NOT NULL,
  "subtotal"          numeric(15, 2) NOT NULL,
  "notes"             text
);

CREATE TABLE "purchase_order_counters" (
  "tenant_id"  uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "year"       integer NOT NULL,
  "next_seq"   integer NOT NULL DEFAULT 1
);
