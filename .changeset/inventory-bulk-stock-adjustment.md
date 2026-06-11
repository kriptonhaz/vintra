---
"@vintra/web": minor
---

Inventory: bulk stock adjustment ("Sesuaikan Stok"). A new page at `/inventory/movements/adjust` lists every active, non-recipe-backed item for a chosen branch in a searchable, category/type-filterable, paginated table. The user enters the actual counted quantity per row; a coloured delta is shown, an optional per-row note appears once a count is entered, and "Simpan Penyesuaian" records the changes in one batch.

Each changed item gets an in/out movement tagged `reason: 'opname'`, with the delta computed server-side from the live balance so it stays correct even if stock moved mid-count. The single-item "Penyesuaian" option is removed from the Catat Pergerakan sheet (leaving Masuk/Keluar) and points users to the new page.
