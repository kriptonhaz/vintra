---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 route fix: rename `pos/reports.tsx` → `pos/reports.index.tsx`
so `/pos/reports/prep-waste` no longer falls through to the P&L
report. The flat-file routing made the prep-waste page a child of
the leaf `reports.tsx` (no Outlet), so visiting the URL silently
rendered the parent. With `.index.tsx`, both routes are siblings
and resolve independently.
