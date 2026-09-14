---
"@vintra/web": minor
"@vintra/db": minor
---

Track supplier payments on purchase orders.

Payments are recorded per PO with a history (amount, date, method, note). The payment status — unpaid, partially paid, paid — is derived from the sum against the PO total rather than stored, so deleting a mistaken payment can't leave a stale status; cancelled POs carry none. The outstanding check runs under a row lock so two simultaneous payments can't overpay. When the tenant's plan includes Cashflow, each payment is mirrored as a `po_payment` expense on the default account and removed with it. The PO list gains a payment badge and filter, and the Excel export gains payment status, paid and outstanding columns.

Migration 0149 adds `purchase_order_payments`, the `po_payment` cashflow source and the "Pembelian dari Supplier" system category. Ported from JuraganQu.
