-- Per-unit pricing + bulk tiers. Replaces the old single-price model
-- (`inventory_items.selling_price`) with a richer per-(item, unit, qty)
-- price ladder. Lets resellers price the same item differently per
-- selling unit (gram vs kg) and apply automatic bulk discounts.
--
-- Schema additions:
--   1. inventory_item_units      — one row per (item, unit), with ratio
--      to base. Replaces inventory_unit_conversions; the base unit is
--      now also a row here (with ratio = 1).
--   2. inventory_item_unit_pricing — multi-tier price ladder per
--      (item, unit). Tier matches when qty >= min_qty; cashier picks
--      the highest matching tier.
--
-- POS additions:
--   3. pos_sale_items gains sold_unit_id + sold_unit_label snapshot,
--      qty_in_base for stock deduction, and is_bulk_price flag for
--      receipt rendering.
--
-- Migration: backfill the new tables from existing data, then drop
-- the old structures (inventory_unit_conversions table + the
-- inventory_items.selling_price column). Safe because there's only
-- test data at this stage — confirmed with the user.

-- ── 1. inventory_item_units ──────────────────────────────────────
CREATE TABLE "inventory_item_units" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "item_id"       uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "unit_id"       uuid NOT NULL REFERENCES "master_hpp_units"("id"),
  "ratio_to_base" numeric(15, 4) NOT NULL DEFAULT 1,
  "sort_order"    integer NOT NULL DEFAULT 0,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_item_units_item_unit_unique"
    UNIQUE ("item_id", "unit_id")
);

CREATE INDEX "inventory_item_units_item_idx"
  ON "inventory_item_units" ("item_id");

-- Backfill: every existing item gets its base unit as a row (ratio = 1).
INSERT INTO "inventory_item_units" (tenant_id, item_id, unit_id, ratio_to_base, sort_order)
SELECT tenant_id, id, base_unit_id, 1, 0
FROM "inventory_items";

-- Backfill: every existing alt-unit conversion becomes a row here.
INSERT INTO "inventory_item_units" (tenant_id, item_id, unit_id, ratio_to_base, sort_order)
SELECT tenant_id, item_id, alt_unit_id, ratio_to_base, 1
FROM "inventory_unit_conversions"
ON CONFLICT (item_id, unit_id) DO NOTHING;

-- ── 2. inventory_item_unit_pricing ──────────────────────────────
-- Tier ladder. Cashier picks max(min_qty <= qty) for the matching
-- (item, unit) — null = item not sellable at that unit yet.
CREATE TABLE "inventory_item_unit_pricing" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "item_id"     uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "unit_id"     uuid NOT NULL REFERENCES "master_hpp_units"("id"),
  "min_qty"     numeric(15, 4) NOT NULL,
  "unit_price"  numeric(15, 2) NOT NULL,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_item_unit_pricing_unique"
    UNIQUE ("item_id", "unit_id", "min_qty")
);

CREATE INDEX "inventory_item_unit_pricing_lookup_idx"
  ON "inventory_item_unit_pricing" ("item_id", "unit_id", "min_qty");

-- Backfill: every existing item with a selling_price gets a tier-1 row
-- on its base unit at min_qty = 1.
INSERT INTO "inventory_item_unit_pricing" (tenant_id, item_id, unit_id, min_qty, unit_price, sort_order)
SELECT tenant_id, id, base_unit_id, 1, selling_price, 0
FROM "inventory_items"
WHERE selling_price IS NOT NULL;

-- ── 3. pos_sale_items: sold-unit + bulk snapshot ─────────────────
-- The qty column is now ALWAYS in the sold unit (not base). The new
-- qty_in_base column carries the base-unit equivalent for inventory
-- deduction. unit_price is per sold unit. is_bulk_price flags lines
-- that hit a tier > 1 so receipts can show "harga grosir".
ALTER TABLE "pos_sale_items"
  ADD COLUMN IF NOT EXISTS "sold_unit_id"     uuid REFERENCES "master_hpp_units"("id"),
  ADD COLUMN IF NOT EXISTS "sold_unit_label"  text,
  ADD COLUMN IF NOT EXISTS "qty_in_base"      numeric(15, 4),
  ADD COLUMN IF NOT EXISTS "is_bulk_price"    boolean NOT NULL DEFAULT false;

-- Backfill existing rows: assume sold unit = base unit (qty was already
-- in base unit under the old model). Safe because these are test sales.
UPDATE "pos_sale_items" si
SET sold_unit_id = i.base_unit_id,
    qty_in_base  = si.qty,
    sold_unit_label = u.label
FROM "inventory_items" i
JOIN "master_hpp_units" u ON u.id = i.base_unit_id
WHERE si.item_id = i.id
  AND si.sold_unit_id IS NULL;

-- ── 4. Drop old single-price field + old conversions table ───────
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "selling_price";
DROP TABLE IF EXISTS "inventory_unit_conversions";
