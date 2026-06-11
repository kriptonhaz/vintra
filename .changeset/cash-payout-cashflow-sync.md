---
"@vintra/web": minor
"@vintra/db": patch
---

Tarik Tunai (cash payout) now posts a linked Cashflow expense.

Previously a Peti Kas Tarik Tunai only decremented the drawer — it never reached the Cashflow ledger — so cashiers logged till-cash expenses in the Cashflow form instead, which can't decrement the drawer. The result was a phantom shortage at close (expected cash counted sales but not the expense). Now one action keeps both ledgers consistent.

- Migration `0117`: adds the `pos_cash_payout` cashflow source value and seeds the `Pengeluaran Kas` system expense category.
- `recordCashPayout` writes a matching `cashflow_entries` expense row (`source='pos_cash_payout'`, `source_ref=<movementId>`) inside the same transaction, but only when the tenant has the Komplit `cashflow` feature.
- Cashiers can tag the payout with an expense category — the same list curated under Arus Kas → Kategori — defaulting to `Pengeluaran Kas`. Picker added to the web Setor/Tarik modal and the mobile Peti Kas sheet.
- The auto-created rows are read-only in the ledger (badge "Tarik Tunai") and a soft hint on the Cashflow expense form points till-cash spending to Tarik Tunai.
