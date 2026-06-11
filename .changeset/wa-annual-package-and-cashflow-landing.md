---
"@vintra/web": minor
"@vintra/shared": minor
---

WhatsApp annual billing + Cashflow on the landing page.

- **WhatsApp annual package** — admins can now record a WhatsApp module payment for a full year, not just monthly. The activation/renewal sheet (and the admin finance screen) gain a "Periode Pembayaran" selector; annual is priced at 12 months minus a flat 10% discount via the new shared `waAnnualPrice` helper. `recordWaPayment` takes a `durationMonths` (1 or 12) and sets the subscription expiry accordingly. The public pricing page shows the annual price + "hemat 10%" on each WhatsApp tier card.
- **Landing page** — added a "Catatan Arus Kas" feature card covering the Cashflow module (income/expense ledger, customer credit, installments, P&L reports).
