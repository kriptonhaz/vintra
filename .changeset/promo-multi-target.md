---
"@vintra/web": minor
"@vintra/db": patch
---

Multi-product + category promos, searchable product picker, and a fix for the duplicate-name dropdown.

- Migration `0118`: new `promotion_targets` table (items + categories), trigger-type CHECK widened with `auto_products` (multi-product) and `auto_category`. The legacy `tenant_promotions.product_id` column is backfilled into the new table and dropped.
- New form scope picker — `Kode` / `Satu produk` / `Beberapa produk` / `Kategori` / `Semua (cart)` — wires through `upsertPromotion` and replaces the old trigger-type select.
- Product picker switched to a searchable `Combobox` (single) / `MultiCombobox` (multi) backed by a new `listSellablePromoProducts` server fn that filters to `is_sellable = true` and surfaces `SKU · Kategori` as a sublabel — so duplicate-looking inventory-only twins no longer appear, and legitimately same-named items stay distinguishable.
- Category picker (multi) backed by a new `listPromoCategories` server fn.
- Cashier matching in `createSale` builds per-item and per-category candidate maps from `promotion_targets`; when multiple promos hit the same cart line, the one with the highest computed discount wins (consistent tie-break).
- Public storefront promo lists drop the per-promo `productName` field; the promo's own `name` already conveys scope and multi-target promos can't surface a single product.
