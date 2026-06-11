---
"@vintra/web": minor
---

Cashflow Phase 5 — dashboard, P/L report + exports (JUR-159).

The "is my business profitable" view, aggregating Phases 1–4.

- New `/cashflow/dashboard`: KPI cards (income / expense / net) with vs-previous-period deltas, a "Posisi Kas Bersih" card (net + outstanding AR − outstanding AP), income/expense-by-category bars, a daily income-vs-expense trend, and outstanding AR/AP cards that deep-link to the bon and cicilan pages.
- Period filter (this month / last month / this quarter / custom) + branch picker.
- "Unduh CSV" exports the ledger for the selected range; "Unduh PDF" generates a printable Laba Rugi (P/L) statement with tenant + branch + period header.
