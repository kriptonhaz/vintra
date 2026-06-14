---
"@vintra/web": patch
---

Fix inventory items list showing stale stock after a stock adjustment. The adjust page only called `router.invalidate()`, but the items list and cashier read stock via React Query rather than route loaders, so their cache stayed stale until a manual browser refresh. The adjust page now invalidates the `inventory.items`, `inventory.stock-adjust`, and `pos` query caches on save.
