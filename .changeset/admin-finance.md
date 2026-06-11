---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Admin financial ledger — manual transactions across paid modules.

Platform admins can now record payments and refunds with a full audit
trail. Replaces the old raw `expiresAt` + `billedStaffCount` activation
form with a plan-aware payment flow that creates a ledger row and
extends the subscription atomically.

Data model (migration 0009):
- `financial_transactions` — append-only ledger; one row per payment
  and one linked row per refund (`status='paid' | 'refund'`,
  `refundOfTransactionId` links refunds to the original).
- `financial_invoice_counters` — per-year monotonic sequence backing
  human-readable invoice numbers like `INV-2026-0001`. Atomic
  upsert + returning so concurrent inserts never collide.

Tenant detail page (`/admin/tenants/$tenantId`):
- New **PaymentSheet** with plan dropdown (1 / 3 / 6 / 12 bulan), live
  total + period preview, transfer date, bank reference, proof photo
  (S3), and notes. Used for both initial activation and renewal —
  renewals stack the new period on top of the current expiry.
- Adjust-without-payment flow preserved for fixing typos.
- New **Riwayat Pembayaran** section showing all of this tenant's
  transactions with a Refund action per paid row.
- Refund sheet includes an "Akhiri langganan sekarang" checkbox —
  admin chooses per refund whether access gets cut.

Finance page (`/admin/finance`) — cross-tenant view:
- Summary cards: paid / refund / net / count for the filtered window
- Filters: date range (defaults to this month), module, status,
  tenant-name search
- Paginated table with tenant links back to the detail page
- Shared `TransactionDetailDrawer` — proof photo via signed URL
  (5-minute TTL), linked refund/original info

Shared pricing (`packages/shared/src/constants/pricing.ts`):
- `ATTENDANCE_PLANS` with `pricePerStaffPerMonth` and `durationMonths`
  becomes the single source of truth for the landing page and the
  admin payment form. Changing prices = one code change, no drift.
- `attendanceTotal(planKey, staffCount)` for server-side amount
  computation.

Audit log gains two new action types: `finance_record_payment` (green)
and `finance_record_refund` (amber), with metadata snapshots of plan,
amount, invoice numbers, and whether the refund ended the subscription.
