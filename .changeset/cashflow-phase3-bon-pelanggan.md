---
"@vintra/web": minor
"@vintra/db": minor
---

Cashflow Phase 3 — Bon Pelanggan / accounts receivable (JUR-157).

Komplit tenants can track customer credit ("bon") — money owed by regulars who buy now and pay later.

- New `ar_receivables` / `ar_payments` tables, migration `0078`; `cashflow_entries.source` widened to allow `ar_payment` (and `ap_payment`, reserved for Phase 4).
- New `/cashflow/bon` page: 4-bucket aging summary (Lancar / Telat 30 / 60 / 90+), a receivables table with per-row payment history, "Tambah Bon" entry, and "Catat Pembayaran" with partial-payment support.
- Recording a payment posts an `ar_payment` income row to the cashflow ledger and flips the receivable to `partial` / `paid`.
- POS auto-create (under-paid sale → AR row) is deferred until the cashier supports credit sales; `createReceivable` is the shared building block that path will reuse.
