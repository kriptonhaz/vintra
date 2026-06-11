---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

JUR-88: Tenant referral code management UI.

- New route `/referrals` (under Settings in the sidebar with a Gift icon).
- List of own codes with copy-to-clipboard, status toggle, attribution
  count, and pencil-edit action.
- Create / edit Sheet with a live "discount + commission ≤ cap" chip that
  mirrors the server-side validation. Random-code helper button.
- Server functions `listMyReferralCodes`, `createReferralCode`,
  `updateReferralCode`, `toggleReferralCode`, `getReferralCap` — all
  tenant-scoped via `requireAuth().tenantId`, cap re-validated on every
  mutation, code uniqueness collisions surfaced as "Kode referral sudah
  dipakai" instead of leaking the raw Postgres error.
- The `code` field is immutable on edit so links already shared in the
  wild stay valid.
- Empty state with onboarding copy. Mobile-responsive.

Will show zero "Pendaftar" counts until JUR-91 (public signup capture)
lands and zero commission until JUR-92 (payment-event wiring). Both are
expected — the ticket is foundation work and is ready to flip on.
