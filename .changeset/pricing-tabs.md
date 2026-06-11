---
"@vintra/web": minor
---

Restructure landing pricing section into per-module tabs (HPP / Absensi / Stok Barang).

Each tab renders its own pricing panel using the same card primitive: HPP as a single hero card, Absensi as 4 commitment cards (Bulanan / 3 Bulan / 6 Bulan / 12 Bulan), Stok Barang as 4 tier cards (Free / Toko / Bisnis / Multi-Outlet) with capacity boxes and feature bullets per tier. Coming-soon strip simplified to POS + Laporan (Manajemen Stok removed since it's now live).

Pricing data is sourced from `ATTENDANCE_PLANS` and `INVENTORY_PLANS` so the marketing page can never drift from the in-app billing pages or admin payment forms.
