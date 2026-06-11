---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-96: extend the referral discount UX to all four admin payment
sheets (was WA-only), with the discount itself applied **server-side**
as a single source of truth.

- New helper `server/lib/referral-discount.ts::applyReferralDiscount`
  looks up the active attribution + 12-month window inside the caller's
  transaction, returns `{finalAmountIdr, discountAmountIdr}`. No-op when
  no attribution exists, so non-referred tenants are unaffected.
- Wired into all four `record*PaymentAndActivate` server fns
  (attendance, inventory, POS, WhatsApp). The persisted
  `financial_transactions.amount_idr` is now the post-discount figure,
  so the commission credit + the invoice both reflect what the tenant
  actually paid.
- New shared UI component
  `components/admin/finance/referral-discount-banner.tsx` exports
  `ReferralDiscountBanner` + `DiscountedTotal`. Replaces the duplicated
  banner / line-through / "Hemat" markup that previously only lived in
  the WA sheet.
- All four sheets (WA, POS, Inventory, Attendance) now accept a
  `referralAttribution` prop and render the discount banner +
  discounted total when present. Komplit bundle banner forwards the
  prop into its embedded POSPaymentSheet too.
- Tenant detail page forwards `referralAttribution` to all four module
  sections + the Komplit banner.
- WA path refactor: the client no longer sends the pre-discounted
  number. Both `WaPaymentSheet`s (component + the local copy in
  /admin/finance) submit `plan.priceIdr` (full price), and the server
  applies the discount. Avoids double-discount risk and matches the
  POS/Inv/Attendance pattern (where server already re-computes amounts).

JUR-97: fix React #418 hydration mismatch on `/referrals/commission`.

The page used `Date#toLocaleString('id-ID', …)` and
`Date#toLocaleDateString('id-ID', …)` for date rendering. Server
(Bun/JSC) and client (V8) produce slightly different output for those
calls — same root cause as the existing `formatRupiah` NBSP issue
documented in `lib/currency.ts` (JUR-17).

Switched the commission page, admin claims queue, and admin referral
config to use the existing `formatDate` helper from `lib/utils.ts`
(date-fns + Indonesian locale), which is deterministic across runtimes.
No more #418 in the console on first load.
