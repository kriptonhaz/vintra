---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Referral epic — admin-side polish from e2e testing feedback.

- **WA pricing alignment**: both `WaPaymentSheet` and the local
  `WaPaymentSheet` in `/admin/finance` now hardcode 49k Basic / 149k
  Komplit (Enterprise dropped — `is_active=false` in the
  `wa_subscription_plans` DB seed). Matches the tenant-facing
  `/whatsapp/billing.tsx` and the DB row. The `recordWaPayment`
  server fn enum was tightened to `'basic' | 'komplit'` so a stale
  Enterprise post is rejected client + server side.
- **Tenant-detail referral banner**: a green "🎁 Pendaftar referral
  — diskon X%" banner now renders at the top of
  `/admin/tenants/$tenantId` whenever the tenant signed up via a
  referral code AND the 12-month window is still open. Surfaces the
  attribution before the admin clicks any module-activation button.
- **WA activation sheet discount math**: when the tenant has an
  active referral attribution, the sheet shows a green
  attribution-info banner, line-through original price, discounted
  total, and "Hemat Rp X (Y%)" annotation. The submitted
  `amountIdr` is the discounted figure, so `financial_transactions`
  + the auto-credit commission both reflect the actual paid amount.
- **Window respected**: the new `adminGetTenantReferralAttribution`
  server fn filters `windowEndsAt > now()`, so once the 12-month
  attribution window elapses the banner disappears and the discount
  stops applying. (Commission credit already had the same check via
  `creditReferralCommissionIfApplicable`.)
- **Submit-claim dialog UX**: auto-close the confirmation dialog on
  error so the user can retry without having to manually dismiss
  the stuck modal first.

POS / Inventory / Attendance payment sheets need the same treatment
— filed as a follow-up.
