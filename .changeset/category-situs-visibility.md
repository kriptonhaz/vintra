---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Per-category situs visibility. Tenants on Komplit can now untick "Tampilkan di situs publik" on a category (e.g. Bungkus / packaging supplies) so its products stay ringable at the cashier but disappear from the public storefront at `q/<slug>`. Default is visible — existing categories are unaffected. New `is_visible_on_situs` boolean on `tenant_categories`; situs query in `getPublicQueueData` now filters by it (uncategorized items still pass).
