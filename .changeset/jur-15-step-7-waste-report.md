---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 7 (final): prep waste / leftover report at
`/pos/reports/prep-waste`.

- New `getPrepWasteReport` server fn aggregates batches by
  (day × item × branch) with SUM(prepared / consumed / leftover) in
  Postgres so any date range works without paging.
- Tier-gated behind `pl_report` (matches main reports page).
- Header stats: total prepared / consumed / leftover + overall waste
  pct. Per-row badge when `leftover / prepared >= 20%` so the owner
  can spot consistent over-prep at a glance.
- Sidebar entry "Laporan Prep & Sisa" under POS Kasir.

Closes JUR-15.
