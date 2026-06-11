---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-94: credit referral commissions on manual admin-recorded payments.

Closes the referral loop without a payment gateway. Tenant A's code is
used by tenant B at signup (JUR-91 wrote the attribution); when admin
records B's payment (any of the four `record*PaymentAndActivate` server
fns), a `referral_commissions` row is now written inside the same
transaction with `status='pending'`, `pending_until = now() +
clawback_days`, and `source_invoice_id` pointing back at the
financial-transaction row.

Refund-side mirror: `recordRefund` now reverses pending / claimable
commissions linked to the original invoice; already-paid commissions
stay at `paid` (money was already wired) and emit an audit-log alert
for manual recovery.

Helper lives at `server/lib/referral-credit.ts`. When the real payment
gateway lands later (JUR-92), the gateway's webhook handler just calls
the same `record*PaymentAndActivate` fns and this credit logic comes
along for free — no second implementation needed.
