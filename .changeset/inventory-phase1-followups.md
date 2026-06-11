---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Inventory Phase 1 follow-ups from first-use review.

**Correctness**
- Fix HPP cost-sync bug: when stock-in uses an alt unit (e.g. 1 pcs at Rp 15.000 with 1 pcs = 1.000 g), the persisted unit cost is now per-base-unit (Rp 15/g) instead of being written verbatim into HPP — previously corrupted the linked HPP material's price by the conversion ratio.
- Branch-cap counting now reflects all active tenant branches (shared resource with attendance), not just branches with stock balances. Closes the gap where Free users could spawn unlimited branches via inventory by never recording stock at them.
- Removed redundant per-movement branch-cap check (was firing incorrectly after the count semantic changed).

**Guardrails**
- Linking an inventory item to an HPP material now requires matching units. Server validates on create/update; client auto-aligns the base unit and disables Save with an inline warning if the user manually overrides into a mismatch.

**UX**
- Item detail: Edit + Delete actions. Delete is hard-delete when there's no movement history, otherwise falls back to deactivate (audit trail preserved).
- Item detail: shows base unit alongside cost and min-stock figures.
- Item detail (Toko+): manage alternate units (e.g. 1 dus = 12 pcs) directly from the page.
- HPP material picker is now a searchable Combobox (new `apps/web/src/components/ui/combobox.tsx`).
- Movement form: per-item unit picker (Toko+), live preview showing base-unit conversion and HPP price impact, Free-tier upgrade nudge for HPP-linked stock-ins.
- Movements list: delete a movement with automatic balance reversal. Refuses if it would push the balance negative, and refuses PO-sourced movements (must unwind via the PO).
- Item detail route fix: renamed `items.tsx` → `items.index.tsx` so the `$itemId` sibling route renders correctly (was matching the parent layout with no `<Outlet />`).
- Raised `listInventoryItems.pageSize` cap from 100 to 500 so the movement form can load all SKUs as a flat picker.
