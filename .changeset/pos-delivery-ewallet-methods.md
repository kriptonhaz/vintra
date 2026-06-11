---
"@vintra/web": minor
"@vintra/db": patch
---

POS: add GoPay, ShopeePay, and OVO as distinct payment methods (for delivery payouts) alongside the generic E-Wallet, and surface a per-method reconciliation summary.

- New methods are available on Toko+ tiers; migration `0084` widens the `pos_sales.payment_method` CHECK constraint.
- `/pos/sales` gains a "Ringkasan per Metode Bayar" card strip — completed-sales totals per payment method plus a grand total, respecting the date filter — so an owner can reconcile the day's takings at a glance.
- The existing `/pos/reports` payment-method breakdown picks up the new methods automatically.
