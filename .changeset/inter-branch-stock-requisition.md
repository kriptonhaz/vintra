---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add inter-branch stock requisitions (JUR-190).

Franchise outlets that are branches of one tenant can now order stock from the main branch inside Vintra instead of bolting on a separate tool. An outlet raises a requisition → the main branch approves → fulfillment moves stock between branches via paired `transfer_out` / `transfer_in` inventory movements, with the source-branch balance decremented and the requesting-branch balance incremented atomically.

- New `stock_requisitions` / `stock_requisition_items` tables (+ an atomic per-tenant number counter), migration `0076`.
- New `/inventory/requisitions` list + detail pages and a "Permintaan Stok" sidebar entry under Inventaris. Toko tier and above.
- Branch scoping: an outlet-scoped user can only raise/cancel requests for their own branch; only a user with access to the main branch can approve or fulfill.
- The tenant owner is notified when a requisition is raised; the requester is notified on approve / reject / fulfill.

Transfer pricing + the Cashflow ledger integration are intentionally out of scope (tracked separately).
