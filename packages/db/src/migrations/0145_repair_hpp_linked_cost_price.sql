-- Repair inventory cost prices that were copied from a FULL BATCH HPP.
--
-- `products.hpp` is the cost to produce one batch (`production_qty` units),
-- but the "Jual di POS" / import paths copied it straight into
-- `inventory_items.cost_price`, which is per base unit. A 40-piece cookie
-- recipe therefore stored a 40x cost: the item read
-- "Modal Rp 25.308,57 / Pieces" and showed a red "Rugi" badge on a product
-- earning Rp 3.367 per piece.
--
-- The code paths are fixed; this repairs rows already written.
--
-- Deliberately NARROW. Only rows where the stored cost still equals the
-- product's batch HPP are touched — that equality is the signature of the bug.
-- Anyone who has since typed their own cost has a value that no longer
-- matches, and their number is left alone. `production_qty > 1` excludes
-- single-yield recipes, where batch and per-unit are the same number and
-- there is nothing to repair.
--
-- Self-limiting: after this runs, cost_price no longer equals hpp, so
-- re-applying is a no-op.

UPDATE "inventory_items" i
SET "cost_price" = ROUND(p."hpp" / p."production_qty", 2),
    "updated_at" = now()
FROM "products" p
WHERE i."linked_hpp_product_id" = p."id"
  AND p."hpp" IS NOT NULL
  AND p."production_qty" IS NOT NULL
  AND p."production_qty" > 1
  AND i."cost_price" IS NOT NULL
  AND ROUND(i."cost_price", 2) = ROUND(p."hpp", 2);
