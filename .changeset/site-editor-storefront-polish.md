---
"@vintra/web": minor
---

Site editor + storefront polish:

- **Sticky live preview**: the "Pratinjau Live" pane now stays in view while the editor controls scroll. Root cause was an app-layout wrapper using `overflow-x-hidden` (which forces `overflow-y: auto` and silently breaks `position: sticky` app-wide); switched to `overflow-x-clip`, and gave the editor grid `items-start` + a header-clearing sticky offset.
- **Storefront search**: a product search box in the Toko Online section filters the catalog by name.
- **Storefront category filter**: category chips (from inventory categories) filter the catalog; auto-hidden when no products are categorised. `getStorefront` now returns each product's category.
- **Storefront grid columns + pagination**: configurable desktop column count (2/3/4) and optional numbered pagination (12/24/48 per page), mirroring the Layanan & Harga section. Pagination runs over the filtered list and resets to page 1 on filter change.

All new controls live in the section's editor settings panel.
