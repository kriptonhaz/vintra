---
"@vintra/web": patch
"@vintra/db": patch
---

Three POS Phase 1 fixes from first-pass user feedback:

**Branch lock on Free**: `getPOSCashierMasters` now slices the branch list to the tier's `branchCap` (Free=1, Toko=2). Cashier UI hides the Select picker when only 1 branch is allowed and shows a readonly "Cabang: <name> · Free · 1 cabang" label instead. New `assertBranchAllowedForTier` server gate inside `createSale` re-validates so a malicious client can't bypass.

**Branch hours soft warning**: New `getPOSBranchHours({ branchId })` server fn reads the existing `branch_schedules` table (already populated by Attendance for staff clock-in windows) and derives `isOpenNow` from current Jakarta wall-clock vs today's `clock_in_time`/`clock_out_time`. Cashier shows an amber banner when the branch is closed today (`isWorkDay=false`) or outside hours; sales are still allowed (soft warning, not a hard block) so late or extended-hours sales aren't rejected.

**Unit alongside price + reseller selling-price workflow**: `listPOSProducts` now joins `master_hpp_units` and returns `baseUnitLabel`. Cashier product cards display "Rp 14 / gram" instead of bare "Rp 14"; cart lines and stock badges include the unit too. Inventory item create + edit forms add "(per gram)" hints next to cost + selling price labels, plus a description below selling price clarifying it's per single base unit. Migration `0018_po_selling_price.sql` adds optional `selling_price` column to `purchase_order_items`. PO line UI gains a "Harga Jual Baru / unit (opsional)" field that pre-fills from the item's current selling price; on receive, lines that carry a non-null `selling_price` AND received some qty propagate the new price to `inventory_items.sellingPrice`. Closes the workflow gap where resellers had to update selling prices in a separate `/inventory/items/$id` step after every restock.
