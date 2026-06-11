---
"@vintra/web": minor
"@vintra/db": patch
---

Inventory: purchase orders can now be placed in any of an item's units, not just the base unit. When an item like "Sirup Jambu" has both Mililiter (base) and Botol (1 Botol = 400 ml), a PO line can be ordered in Botol.

- Migration `0086` adds `unit_id` + `unit_ratio` to `purchase_order_items`; the ratio is snapshotted at order time so a later edit to the unit definition can't shift an in-flight PO. Legacy rows (null) are read as the base unit.
- The create-PO form gains a per-line unit dropdown; quantity/cost labels follow the chosen unit and the unit-cost field pre-fills from the item's cost scaled to that unit.
- On receive, ordered quantities and cost convert to base units (`qty × ratio`) before writing stock movements and balances, so inventory stays correct regardless of the ordered unit. The receive sheet and PO detail show the ordered unit.
