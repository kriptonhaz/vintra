-- Adds optional selling_price per PO line so resellers can set both
-- the buy cost AND the resale price in one workflow. On PO receive,
-- when this column is set, the inventory item's selling_price gets
-- updated. NULL = "no change to selling price" (default behaviour for
-- non-resellers).
ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "selling_price" numeric(15, 2);
