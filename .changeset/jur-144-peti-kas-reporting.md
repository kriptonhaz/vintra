---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-141 / JUR-144 PR 3 — Peti Kas owner reporting + Z-report data hook:

**New route** `/pos/cash-sessions` (under POS Kasir nav)
- Filters: from / to (defaults to current month) / branch (auto-scoped via JUR-135) / status (open/closed/all) / "ada selisih saja" checkbox.
- Table columns: Tanggal, Cabang, Kasir, Modal, Ekspektasi, Fisik, Selisih, Status.
- Variance highlight: `|variance| ≥ tenant's cash_variance_threshold` → red bold + `AlertTriangle`. Below threshold → muted gray.
- Status pills: open (emerald), closed (gray), force_closed (amber + lock icon).
- Row click opens a side `<Sheet>` with full detail: rekap (opening + cash_in − cash_out = expected vs actual + variance), opening/closing notes, full movement ledger with type badges (sale/refund/drop/payout) and per-row signed amounts.
- CSV export — minimal client-side blob; PR 4 (JUR-145) will finalise the column shape per the ticket spec.

**Permissions**
- New `MODULE_NAV` entry under POS Kasir gated by `permission: 'pos.read'`.
- `listCashSessions` + `getCashSessionDetail` server fns now auto-restrict cashiers (no `pos.manage` permission) to their own sessions only. Supervisors + owners see everything.

**Z-report data hook**
- `getDailyZReport` server fn (in `apps/web/src/server/functions/pos.ts`) now returns a `cashReconciliation: { sessions[], totalVariance }` block: per-session variance for the day + the day's net variance total. Closed + force-closed sessions counted differently — force-closed excluded from `totalVariance` because their physical count wasn't real.
- No UI consumer exists yet for the JSON Z-report (only the PDF generator, which has its own SQL path). PR 4 will extend the PDF + any future on-screen Z-report to render the new block.

**i18n**
- New keys under `pos.cashSessions` (id + en) — list page columns, filters, detail drawer labels, movement type badges. Follows JUR-138 glossary.

**Backward-compat**
- Page renders for any tenant with `pos.read`. Empty state when there are no sessions yet — true for everyone today because `cash_drawer_enabled` is still `false` from PR 1.
