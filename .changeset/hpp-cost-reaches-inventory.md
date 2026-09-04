---
"@vintra/web": patch
"@vintra/db": patch
---

Make HPP costs reach the item list, and let the bulk screen refresh.

Two problems, one root cause: the HPP → inventory bridge was one-way and one-shot.

A recipe-backed item's cost was copied from HPP at import time and then frozen.
Raising the price of one ingredient moved every recipe's HPP while the item list and
POS catalog kept showing the old "Modal" indefinitely — the number an owner reads
when deciding what to charge. `recalcTenantHpp` now pushes each moved product's cost
into its linked items in the same transaction, the way selling prices already did
via `pos-price-sync.ts`. Recorded sales were never affected: the sale path reads the
live `products.hpp`.

The `auto_sync_hpp_cost` toggle governs this and is now offered on recipe links, not
just ingredient links — so a tenant who prices an item some other way has the same
way out they always had for ingredients. An update that omits the field no longer
resets it to on, which would have let a partial update silently re-enable a sync the
owner had switched off.

"Tambah Massal dari HPP" was import-only: once a material or product had an
inventory item, its row was locked forever. A tenant whose catalog was fully
imported opened the page to find every row greyed out and the save button dead —
nothing to add, and no way to pull in later HPP changes. Rows now show the drift
(`old → new`) and can be ticked to re-sync cost and, for products, the tier-1 POS
price. A row whose auto-sync toggle is off is left alone: that is a deliberate
opt-out, not drift.
