---
"@vintra/web": patch
---

Fix: the inventory item list (`/inventory/items`), purchase-order list (`/inventory/po`), and stock-requisition list (`/inventory/requisitions`) now follow the topbar branch switcher. They loaded their data once in a route loader (server-side, before the component) so they ignored the selected branch. Each list is now a per-branch client query that re-fetches on switch. `listRequisitions` gained a `branchId` filter (a requisition matches when it requested from or fulfills to that branch).
