---
"@vintra/web": minor
---

Add four new POS report routes — Penjualan per Kategori, Penjualan per Produk, Laporan Pelanggan, Laporan Diskon — under a nested sidebar group.

- Sidebar nav now supports two-level nesting; "Laporan POS" expands into Ringkasan, Kategori, Produk, Pelanggan, Diskon, and Prep & Waste.
- Each new route reuses a shared filter bar (date preset chips + Dari/Sampai + Cabang) and a generic table primitive that renders as a real table on desktop and a card-stack on mobile.
- All four are gated on `pos.report.view` (owner / admin / outlet_owner / supervisor) and the `pl_report` POS tier feature; margin/HPP columns are conditionally included on `pos.report.profit`.
- Anonymous walk-in sales are excluded from the Pelanggan table and surfaced as a single summary chip above it.
- Each route exports both CSV and PDF with a shared header/footer helper.
- Existing `/pos/reports` overview was refactored to use the new shared filter bar and report tabs nav — no behavior change.
