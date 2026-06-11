---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-141 / JUR-142 PR 1 — Peti Kas schema + server fns (data layer only, zero UX impact):

**Schema**
- New `pos_cash_sessions` table — one row per cashier open/close cycle. Partial unique index `(branch_id, cashier_user_id) WHERE status = 'open'` enforces at most one open session per cashier at the DB level.
- New `pos_cash_movements` table — ledger of every cash event in a session (sale, refund, drop, payout). CHECK constraints enforce `reason` required for drop/payout and `reference_sale_id` required for sale/refund.
- Adds `pos_settings.cash_drawer_enabled` (boolean) — **defaults to `false`** so PR 1 ships safely (a `true` default would break cash sales for every existing tenant before the PR 2 UI lets them open sessions). PR 4 will flip to `true` for Komplit tenants in a one-time UPDATE and change the column default to `true` for new onboarding.
- Adds `pos_settings.cash_variance_threshold` (numeric, default Rp 10.000).
- Migration `0055_pos_cash_drawer.sql` (idempotent CREATEs + ALTERs).

**Server fns** (`apps/web/src/server/functions/pos-cash.ts`)
- `getCurrentOpenSession({ branchId })` — UI mount-time check. Returns `{ disabled: true }` for tenants who toggled off, `{ session: null }` when no open session, or the session with derived `runningBalance` + `isStale` flag.
- `openCashSession({ branchId, openingBalance, openingNotes? })` — INSERT with friendly Indonesian translation of the 23505 unique-violation when a session is already open.
- `closeCashSession({ sessionId, actualClosing, closingNotes?, forceClosed? })` — recomputes `expected_closing` from the ledger as a sanity check vs the rolling totals, writes variance, flips status.
- `recordCashDrop` / `recordCashPayout` — symmetric `{ sessionId, amount, reason }` validators.
- `listCashSessions(...)` — owner reporting list, branch-scoped via JUR-135.
- `getCashSessionDetail({ sessionId })` — session header + full movement ledger (newest first) for the detail drawer.

**createSale + voidSale wiring** (`apps/web/src/server/functions/pos.ts`)
- Cash sales resolve the open session BEFORE the transaction starts. No open session + drawer enabled ⇒ throws `'Buka Kas dulu sebelum jualan tunai.'` (literal — PR 2 UI matches on it).
- On a successful cash sale, an atomic `pos_cash_movements` row of `type='sale'` is INSERTED in the same `db.transaction`, with `amount = effectiveTotal` (NET cash change in the till — paid minus change-back).
- Voiding a cash sale resolves the CURRENT open session for (branch, void-caller) and INSERTs `type='refund'` movement linked back to `pos_sales.id`. Prior-session sales hit today's open session — matches the agreed JUR-141 design.
- `getPOSCashierMasters` returns a new `cashDrawer: { enabled, varianceThreshold }` block so PR 2's cashier UI doesn't need a second round-trip.

**Backward-compat**
- Default `cash_drawer_enabled = false` means PR 1 has zero behavioral impact for any existing tenant. Cash sales work exactly as before because the gate short-circuits when disabled.
