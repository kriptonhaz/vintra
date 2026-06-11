---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-14: Migrate HPP unit text columns to `master_hpp_units` FK.

Tech-debt cleanup follow-up to JUR-10. `materials.unit` and `product_materials.unit` were free-text columns; every value across all tenants happened to match a `master_hpp_units.value` (verified pre-migration), but the link was brittle — typos / drift could break unit conversion silently.

**Schema** (`0028_hpp_unit_fk.sql`):
- Added `unit_id uuid REFERENCES master_hpp_units(id)` (nullable) to both tables
- Backfilled from text via `master_hpp_units WHERE value = lower(trim(unit))` (28 rows)
- DO block raises if any backfill is incomplete (catches rare drift between data check and migration apply)
- Dropped legacy `unit text` columns
- Marked `unit_id NOT NULL`

**Server** (hpp.ts + inventory.ts):
- All reads of `materials.unit` / `product_materials.unit` now join `master_hpp_units` to get the value/label (aliased twice in queries that read both tables' units, e.g. `getProductMaterials` / `calculateProductHpp`)
- `assertHppUnitMatchesBase` switched from text equality to FK equality — no string normalisation needed
- `createMaterial` returns `unit` + `unitLabel` from the master row so callers can write the unit back to form state without an extra round-trip
- `addProductSubProduct` input changed from `unit` to `unitId`

**JUR-10 deduction simplified** (pos.ts):
- The runtime "WHERE value = lower(unit)" lookup is gone — `productMaterials.unitId` is read directly from the BOM query, joined with `master_hpp_units` for the error-message label
- Recipe unit comparison against ingredient `baseUnitId` is now FK ⇄ FK
- Same hard-error behaviour on unit mismatch (Q1 contract preserved)

**Validators** (`packages/shared/src/validators/hpp.ts`):
- `createMaterialSchema.unit` (text) → `unitId` (uuid)
- `createProductMaterialSchema.unit` (text) → `unitId` (uuid)

**Master data API**:
- `getHppUnits` now returns `id` alongside `value` + `label` so HPP forms can persist `unitId` (FK) without a second round-trip

**Forms** (`hpp/calculate.tsx`, `hpp/products.tsx`, `master/suppliers.tsx`):
- Form fields keep storing `unit` as text (cashier mental model: "gram", "ml")
- Submit-time translation via a `unitIdByValue` Map built from the master units cache
- `resolveUnitId` callback threaded into `StepKomponenBiaya` for the auto-create-material path
- Server returns the unit text (via join) so post-save form state stays consistent

**Data check verified post-migration**:
- `materials`: 15 rows, 0 nulls
- `product_materials`: 13 rows, 0 nulls
