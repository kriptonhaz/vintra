---
"@vintra/web": minor
"@vintra/db": patch
---

Bring Permintaan Stok to parity with Buat PO.

The form now lets the cashier pick a unit per line (kg, liter, etc.) instead of being silently locked to the item's base unit. The "Tambah Baris" button moved from the section header to the end of the item list — matches the PO sheet, and makes the new-line target predictable.

- Migration 0119: `stock_requisition_items` gains `unit_id` (FK → master_hpp_units) + `unit_ratio` (numeric 15,4). Both nullable; NULL = base unit / ratio 1, so the single existing requisition row stays valid.
- New `listItemsForRequisition` server fn — same shape as `listItemsForPO` but feature-gated on `assertRequisitionFeatureAvailable`.
- `createRequisition` accepts `unitId` per line and snapshots `unitRatio` so a later inventory_item_units edit can't desync an in-flight requisition.
- `fulfillRequisition` converts qty → base via the snapshot ratio for the actual stock movements. `requestedQty` and `fulfilledQty` stay in the chosen unit (so the UI renders both with the same label); the franchise purchase total uses `qty × ratio × unitPrice` since unitPrice is per-base (snapshot of `inventoryItems.franchisePrice`).
- `getRequisition` returns a render-friendly `unitLabel` (chosen unit, falling back to base) and `unitRatio`. The detail view renders requested + fulfilled qty with the chosen unit label and applies the ratio to the priced-line total.
