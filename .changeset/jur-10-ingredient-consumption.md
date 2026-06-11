---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-10: Auto-deduct BOM ingredients on POS sales (Toko+ feature).

When a recipe-backed inventory item is sold, every ingredient declared in its HPP `productMaterials` BOM is now automatically deducted from inventory at the sale's branch. Mirrors Qasir Pro's "Resep" → stock flow but uses our existing HPP recipe data as the source of truth (no duplicate "Recipe" table — owners only configure recipes once).

**Schema** (`0025_pos_ingredient_consumption.sql`):
- `product_materials.material_id` is now nullable
- New `product_materials.source_product_id uuid REFERENCES products(id)` for nested-recipe (sub-product) BOM rows
- CHECK constraint: exactly one of (material_id, source_product_id) must be set per row
- Index on `product_materials(product_id)` for the deduction-side traversal

**Server** (`createSale` + `voidSale` in `pos.ts`):
- New `deductIngredientsForLine` helper: walks the BOM, resolves the inventory item linked via `linkedHppMaterialId`, converts the recipe quantity to the ingredient's base unit (via `inventory_item_units.ratioToBase`), inserts an `inventory_movements` row (`reason='pos_sale_ingredient'`) + updates the balance — all in the same `db.transaction` as the sale.
- Hard error on unit mismatch (per-design: silent skip would let stock leak invisibly).
- Skip + per-(tenant, material) idempotent notification (`pos_unlinked_material`) when a material isn't linked to inventory.
- Sub-product BOM rows are detected and trigger a per-(tenant, product) notification (`pos_nested_recipe_skipped`) — v1 doesn't recurse into nested recipes; v2 will.
- `voidSale` reverses every `pos_sale_ingredient` movement with a compensating `pos_void_ingredient` `'in'` movement, keyed off `referenceType='pos_sale' + referenceId=sale.id`.
- `createSale` returns `recipeNudge: boolean` — true when a Free-tier sale rang a recipe-backed product (cashier shows a one-time-per-session toast).

**Tier gate**:
- New `ingredient_consumption` flag in `POSFeatureFlag`, included in `POS_TOKO_FEATURES` (inherited by Bisnis + Komplit). Free tier configures recipes (HPP is free) but doesn't run the deduction.

**HPP step-2 save loop** (`calculate.tsx`):
- Sub-product cost components (where step-2 lets owners pick a product as an ingredient) are now persisted via the new `addProductSubProduct` server fn, writing `productMaterials` rows with `source_product_id` set instead of being silently dropped on the floor. Captures the structural data so v2's recursion can ship without backfill.

**UI**:
- Inventory item detail page: new "Stok-out otomatis saat penjualan" panel listing every recipe ingredient + its inventory link status. Unlinked materials get an inline ⚠ warning, nested-recipe sub-products get a "Coming soon" line.
- Cashier: one-time-per-session toast on Free-tier sales of recipe-backed products inviting Toko upgrade.

**Out of scope** (follow-up tickets):
- JUR-14: migrate `materials.unit` / `product_materials.unit` from text to `master_hpp_units` FK (this PR uses runtime text-→-id lookup).
- v2: traverse `source_product_id` rows recursively to deduct sub-product ingredients (one level for now is the typical merchants kafe use-case).
- Optional receipt footer ("Termasuk: 200ml susu, 5g gula") — separate ticket.
