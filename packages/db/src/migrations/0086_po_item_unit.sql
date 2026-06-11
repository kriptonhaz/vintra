-- Per-line ordered unit for purchase orders.
--
-- purchase_order_items previously expressed ordered_qty / unit_cost /
-- subtotal in the item's base unit only. These columns let a PO line
-- be placed in any of the item's units (e.g. "10 Botol" where
-- 1 Botol = 400 ml). unit_ratio snapshots inventory_item_units.
-- ratio_to_base at order time, so a later edit to the unit definition
-- can't shift an in-flight order.
--
-- Both nullable: legacy rows (NULL) are read as "base unit, ratio 1",
-- so no backfill is needed.
--
-- Rollback:
--   ALTER TABLE "purchase_order_items" DROP COLUMN "unit_ratio";
--   ALTER TABLE "purchase_order_items" DROP COLUMN "unit_id";

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "unit_id" uuid REFERENCES "master_hpp_units"("id");

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "unit_ratio" numeric(15, 4);
