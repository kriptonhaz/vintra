---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Customer import gains an opt-in "Timpa saldo poin pelanggan yang sudah ada" checkbox in the file-picker step (`ImportCustomersDialog`). Default off — the existing safe behaviour stays the default. When ticked:

- Existing customers' `customer_loyalty_balances.points_balance` is overwritten to the value in the spreadsheet.
- For every overwrite, a `customer_loyalty_movements` row of type `'adjust'` is written with `points = |delta|` and reason `"Import override (yyyy-mm-dd): saldo {prior} → {new}"`, so the customer detail page's poin history records exactly what changed and when.
- `lifetime_earned` is intentionally preserved — that's a historical earnings record, not the current balance.
- The preview summary surfaces a new `Poin di-override` tile so the operator sees the count before committing.

Server: `importCustomers` accepts an optional `overrideLoyalty: boolean` (default false) wired through preview + commit modes. New `poinOverridden` count returned in the summary; `poinSkippedExisting` continues to surface the count when the flag is off.

Intended workflow: tenants migrating from Qasir at end of business day tick the checkbox so the file becomes authoritative; routine re-imports of an older export leave it off so nobody accidentally erases recent earnings.
