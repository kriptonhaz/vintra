---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Cashflow Phase 4 — Cicilan / accounts payable (JUR-158).

Komplit tenants can track money they owe on installment plans — supplier cicilan, equipment, recurring bills.

- New `ap_payables` / `ap_payments` tables, migration `0079`.
- New `/cashflow/cicilan` page: summary cards (outstanding / due this month / due next 30 days), payable cards with an expandable installment schedule, "Tambah Cicilan" (one-off or N-month — the schedule is generated up front), and "Tandai Lunas" per installment.
- Marking an installment paid posts an `ap_payment` expense row to the cashflow ledger.
- Past-due installments show a "Telat" badge; a daily scheduler tick notifies the owner about installments due within 3 days (mutable per payable).
