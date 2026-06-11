-- Inventory `is_favorite`: per-item flag that pins the item to the top
-- of the POS cashier grid when the "Semua" (all categories) filter is
-- active. Lets owners surface best-sellers / staple items first so
-- cashiers don't scroll to find them. Default false — opt-in per item
-- from the inventory item detail page.
--
-- The cashier query orders by `is_favorite DESC, name ASC` when no
-- category is selected. A category-specific filter ignores the flag
-- (favorites only matter for the "all" view; inside a category the
-- alphabetical order is what the cashier expects).

ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "is_favorite" boolean NOT NULL DEFAULT false;

-- Partial index — only favorites carry the flag (everything else is
-- the default false), so the index stays tiny and the sort on the
-- "Semua" view stays fast even as catalog size grows.
CREATE INDEX IF NOT EXISTS "inventory_items_tenant_favorite_idx"
  ON "inventory_items" ("tenant_id", "name")
  WHERE "is_favorite" = true;
