---
"@vintra/web": minor
---

POS Kasbon — credit sales + kasbon pay-down from the cashier (JUR-191).

Komplit tenants can now ring credit sales directly at the cashier and let customers pay down existing kasbon as part of a transaction.

- New "Transaksi kasbon" toggle in the payment modal — when on (and a customer is attached), the cart can be paid less than the total; the gap becomes a new `ar_receivables` row linked to the sale.
- New "Bayar kasbon" field, shown only when the attached customer has outstanding kasbon. It defaults to empty and is never pre-filled — the cashier types an amount only after the customer agrees to pay. The amount applies FIFO across the customer's outstanding receivables.
- `createSale` recognises cashflow income on the cart amount actually paid (`pos_sale`) and on each kasbon payment (`ar_payment`) — the credit gap is never counted as income. Cash-drawer movements reflect real cash in.
- Kasbon is gated on the Komplit `cashflow` feature and requires an attached customer; anonymous sales cannot kasbon.
- The customer detail page now shows outstanding kasbon alongside loyalty points.
