-- Inventory `is_sellable`: explicit flag for whether an item appears
-- in the POS catalog. Until now `listPOSProducts` returned every
-- inventory item with at least one priced unit — which leaked raw
-- ingredients (Teh Tubruk, Air Mineral) into the cashier grid even
-- when they were only meant to be tracked for HPP / stock purposes.
--
-- Defaults that match the shipping ergonomic:
--   linkedHppMaterialId set + linkedHppProductId null → false
--     (this row is an ingredient inventory item, e.g. Teh Tubruk —
--      bridges to an HPP material; usually NOT sold standalone)
--   everything else → true (legacy + new sellable items)
--
-- Admin can still flip the toggle on the inventory item form for the
-- bahan-baku-store edge case where a tenant DOES sell raw materials.

ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "is_sellable" boolean NOT NULL DEFAULT true;

UPDATE "inventory_items"
SET "is_sellable" = false
WHERE "linked_hpp_material_id" IS NOT NULL
  AND "linked_hpp_product_id" IS NULL
  -- Don't downgrade items the user has explicitly priced for sale —
  -- if they have at least one unit-pricing row, leave them sellable.
  AND NOT EXISTS (
    SELECT 1
    FROM "inventory_item_unit_pricing" p
    WHERE p.item_id = inventory_items.id
  );
