---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-11: P&L / monthly report (Toko+).

Owner-facing aggregations for any custom date range — turns the snapshot data we've been writing across W1-W4 (HPP per line, line + sale discounts, loyalty redemption, tax, ingredient cost) into a single report owners can actually see. Headline harvest ticket — no new schema, pure aggregation.

**Server** (`getPOSReport` in `pos.ts`):
- Single fn, takes `{ branchId?, from, to }`. Returns ringkasan + top-by-qty + top-by-revenue + payment-method breakdown + cashier breakdown.
- All math is straight `pos_sales` + `pos_sale_items` aggregations.
- Jakarta TZ window: `((from::date::timestamp) AT TIME ZONE 'Asia/Jakarta')` so `to + 1 day` covers the whole last day.
- Cashier names resolved via Supabase admin API (cheap when there are few cashiers per window).

**Tier**:
- `pl_report` flag added to `POSFeatureFlag`, included in `POS_TOKO_FEATURES` (inherited by Bisnis + Komplit). Free still gets daily Z-report via `/pos/sales`.

**UI** (`/pos/reports`):
- Date-range presets (Hari ini / Kemarin / 7 hari / 30 hari / Bulan ini / Bulan lalu / Custom) + branch picker
- Ringkasan stat grid (Pendapatan, HPP, Untung kotor, Margin %, Diskon item/cart, Pajak, Tukar poin, Sales/Voided counts + total)
- Top 10 items — by qty + by revenue, side-by-side on desktop
- Payment method breakdown (count + % + total)
- Cashier breakdown (rendered only when ≥2 distinct cashiers in the window)
- Free-tier upgrade banner when feature is missing

**Export** (client-side, no extra round-trip):
- CSV via plain text generation (escaped quotes for names with `,` or `"`)
- PDF via existing `jspdf` dep — A4 layout with Ringkasan + Top 10 + Payment + Per-Kasir sections, auto-paginated

**POS subnav**:
- New "Laporan" tab (gated on `pl_report` feature flag, requires `pos.read` permission)
- Indonesian + English i18n keys added
