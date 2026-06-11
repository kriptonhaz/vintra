---
"@vintra/web": patch
---

Fix several spots where adding/editing/deleting tenant data didn't immediately show up on every surface that displays it. Audit found four data axes (categories, materials, products, suppliers) whose mutations only invalidated the primary query key, leaving the POS cashier masters bundle, the loyalty stamp-form bundle, the inventory items list, and PO line/supplier pickers stale until a manual refresh. New `lib/invalidate.ts` exposes one helper per axis that invalidates every consumer key in one call; `master/categories`, `master/suppliers`, `hpp/index`, and `hpp/calculate` now use those helpers (covering the inline supplier/material/category creation paths inside the calculator too).
