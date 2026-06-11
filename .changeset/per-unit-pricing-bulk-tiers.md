---
"@vintra/web": minor
"@vintra/db": minor
---

Per-unit selling prices + bulk tier pricing for inventory + POS.

**Why**: merchants commonly need to sell the same item in different units (sugar by gram for HPP recipes, by kg as packs to retail customers) at independent prices, AND offer volume discounts (1 pcs = Rp 2,500; 20 pcs = Rp 2,200/each). The previous single-`selling_price`-per-item model couldn't express either.

**Schema (migration `0019_inventory_unit_pricing.sql`)**:
- New `inventory_item_units` table — one row per `(item, unit)`, each with `ratio_to_base`. The base unit is now also a row here (ratio = 1). Replaces the old `inventory_unit_conversions` table.
- New `inventory_item_unit_pricing` table — multi-tier price ladder per `(item, unit)`. Tier matches when `qty >= min_qty`; cashier picks the highest matching tier. Independent ladders per unit (sugar/gram has its own tiers; sugar/kg has its own).
- `pos_sale_items` gains `sold_unit_id`, `sold_unit_label`, `qty_in_base`, `is_bulk_price`. The `qty` column now means "qty in sold unit"; `qty_in_base` carries the equivalent for inventory deduction. Receipts show "2 kg × Rp 13.500 (grosir)" instead of bare base-unit numbers.
- Backfilled both tables from existing data, then dropped `inventory_items.selling_price` + the old conversions table.

**Server**:
- `getInventoryItem` returns a `units` array (each with its tier ladder) instead of the old `unitConversions` shape.
- `listInventoryItems` returns `lowestBaseUnitPrice` (cheapest tier-1 across units, normalised per base) + `pricingUnitCount` so the list view can show "Jual mulai Rp 14/gram (2 unit)" or "Belum ada harga jual".
- New mutations: `addItemUnit` / `removeItemUnit` (replaces `addUnitConversion` / `removeUnitConversion`), `upsertPricingTier` / `removePricingTier`. The base unit is auto-seeded on item create.
- `createInventoryItem` accepts an optional `initialSellingPrice` that seeds a tier-1 row on the base unit so simple "1 unit = 1 price" items remain a one-step setup.
- `recordMovement` reads ratios from `inventory_item_units` instead of the old conversions table.
- PO receive's reseller workflow now upserts the inventory item's base-unit tier-1 price (instead of the dropped `selling_price` column).
- POS `listPOSProducts` returns each item with its full `units` array (each carrying its tier ladder). Items with zero priced units are filtered out.
- POS `createSale` accepts `unitId` per line, looks up the matching tier server-side (highest `min_qty <= qty`), refuses lines that don't match any tier, snapshots the sold unit + bulk flag onto `pos_sale_items`, and writes inventory movements in base units (`qty × ratio`). `voidSale` reverses with the stored `qty_in_base`.
- POS receipt PDFs (thermal + A4) render the sold-unit qty and tag bulk-priced lines with "(grosir)".

**UI**:
- Item detail page replaces the old "Unit Konversi" section with **"Unit & Harga"**: each configured unit (incl. base) becomes a card showing its ratio + a tier ladder editor (min qty + price + delete). Inline soft yellow warning when a tier price is below cost ("akan rugi Rp X/unit"); blocking confirm when price < cost × 0.5 (likely typo).
- Item create form: replaces the single "Harga Jual" input with an optional "Harga Jual Awal" — when filled, server seeds the base unit's tier-1 row. A help card directs admins to the per-unit + tier editor for advanced setups.
- Item edit form: drops the bare selling-price input entirely (it lives in the per-unit editor now).
- Item list view: shows "Jual mulai Rp X / unit (N unit)" or "Belum ada harga jual" instead of a single price.
- Cashier product card shows "mulai Rp X / unit" when item has multiple units, plus stock displayed in the largest configured unit ("Stok: 1.5 kg" instead of "Stok: 1500 gram") so cashier reads it the way customers ask.
- New `UnitTierModal`: opens when tapping a multi-unit (or multi-tier) item. Unit chips, qty stepper, live tier preview with "Harga Grosir aktif (≥ X)" badge, "next bulk threshold" nudge ("Tambah 5 lagi untuk dapat harga grosir Rp X"), and a one-tap "snap to next tier" shortcut. Single-unit + single-tier items skip the modal and snap straight into cart.
- Cart line shows "Harga Grosir" badge when bulk pricing applied. Stepping qty up/down on a tiered line auto-re-tiers the price client-side; server re-validates on submit.
