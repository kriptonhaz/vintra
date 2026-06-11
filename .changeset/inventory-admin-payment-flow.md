---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Inventory admin payment flow + UX polish.

**Admin: inventory activation now goes through the same payment ledger as attendance.**
- Replaced trial-only `InventoryModuleSection` with Aktifkan / Perpanjang / Nonaktifkan controls mirroring the attendance pattern. Trial UI removed.
- New `InventoryPaymentSheet` (flat-priced, no per-staff field) writes a `financial_transactions` row with `module_key='inventory'`, so paid Inventory activations appear in the tenant's Riwayat Pembayaran alongside attendance.
- New `getInventorySubscription` + `deactivateInventory` server fns (mirror attendance shapes).

**UX**
- Indonesian thousand-separator formatting for movement quantities (`50.000`) and `Rp` prefix for unit costs (`Rp 14`).
- Stock per-branch badge now shows the unit label.
- Sidebar order: HPP → Stok Barang → Absensi → POS Kasir → Laporan.
- WhatsApp upgrade/contact links on `/inventory/billing` and `/inventory/locked` now use the canonical sales number `+62 877 6568 5391` (was a placeholder).
