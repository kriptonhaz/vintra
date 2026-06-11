---
"@vintra/web": minor
---

Inventory: bulk-import items from HPP. A new "Tambah Massal dari HPP" page (`/inventory/items/import`) lists every HPP material and finished product in an editable table — pick a source tab, and un-imported rows come pre-selected. Unit, cost price, and (for products) selling price are inherited from HPP; the user only sets minimum stock, "Tampilkan di POS Kasir", and "Bisa pesan di booking" per row. Rows already linked to an inventory item are flagged "Sudah ditambahkan" and skipped, so the import is dedup-safe and respects the tier SKU quota.
