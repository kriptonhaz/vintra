-- Configurable "default sale unit" per inventory item. When an item has
-- multiple units (e.g. sugar in gram + kg), the cashier card needs to
-- pick ONE to display the price + stock in. Today it defaults to the
-- largest unit by ratio — but that's not always what the merchant wants
-- (a kafe might prefer to display sugar in gram even though kg is
-- larger, because that's how they think of it in recipes).
--
-- Rule: exactly one unit per item is `is_default = true`. The cashier
-- uses that unit for both price-display and stock-display. Backfill
-- sets the BASE unit as default for every existing item — that matches
-- the previous behaviour (base unit was implicit default) and keeps the
-- migration safe.

ALTER TABLE "inventory_item_units"
  ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;

-- Backfill: mark each item's base-unit row as default.
UPDATE "inventory_item_units" iu
SET is_default = true
FROM "inventory_items" i
WHERE iu.item_id = i.id
  AND iu.unit_id = i.base_unit_id;

-- Partial unique index: at most ONE default row per item. Lets us flip
-- defaults atomically (set new = true, set old = false within a tx)
-- without violating the constraint mid-flight if the writes are
-- ordered correctly.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_item_units_one_default_per_item"
  ON "inventory_item_units" ("item_id")
  WHERE "is_default" = true;
