---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Add `is_favorite` flag to inventory items so owners can pin best-sellers / staples to the top of the POS cashier grid.

- New `is_favorite` boolean column on `inventory_items` (default false) with a partial index on `(tenant_id, name) WHERE is_favorite = true` so the cashier sort stays fast even with thousands of items.
- Cashier `listPOSProducts` now orders by `is_favorite DESC, name ASC`. Favorites bubble to the top of the "Semua" view — inside a specific category the order is effectively unchanged (favorites within one category just sort first, alphabetically among themselves).
- Cashier tile renders a small star badge on favorited items so the cashier can see why they're at the top.
- Inventory item detail page (`/inventory/items/<id>`) has a new "Produk Favorit" section with a one-tap toggle (`setInventoryItemFavorite` server fn). Also exposed via the edit sheet for completeness, but the section avoids forcing the operator into the full edit flow mid-shift.
