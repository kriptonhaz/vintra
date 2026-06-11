---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

POS Peti Kas: Setor Tunai (`drop`) now **adds** cash to the drawer instead of deducting it. The previous behaviour modelled "setor" as "cash handed up to the safe/owner" (an outflow), which contradicted how merchants cashiers actually use the action — topping up the float, returning unused change from a purchase, etc. Tarik Tunai (`payout`) stays as the outflow side.

Changes:
- `insertCashMovement` now bumps `cash_in_total` for `'drop'` (alongside `'sale'`); refund + payout keep bumping `cash_out_total`.
- `closeCashSession` aggregation sums `'drop'` into the cash-in side.
- Tutup Kas modal: expected = opening + cashSales + drops − refunds − payouts; Setor row now renders as a `+amount`.
- Cash sessions detail view colours `'drop'` rows as inflows.
- ID/EN copy + docstrings updated to describe putting cash INTO the drawer.

Impact on existing data: 1 row tenant-wide at the time of this change (an already-closed test session whose stored expected/actual/variance snapshot is left untouched). Future drops will now behave correctly.
