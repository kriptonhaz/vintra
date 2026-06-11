---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Complete JUR-96 — surface referral discount in `/admin/finance` WA payment sheet:

The per-tenant detail page already wired `referralAttribution` into all 4 payment sheets (POS / Inventory / Attendance / WA) in the JUR-94 round. The `/admin/finance` page has its own local quick-record WA sheet (admin pastes a tenant UUID directly) that wasn't loading attribution.

Now: when the admin enters a valid UUID into the Tenant ID field, the sheet fetches `adminGetTenantReferralAttribution` and renders the shared `ReferralDiscountBanner` + `DiscountedTotal` so the admin sees the discount math before submitting. Server still applies the discount via `applyReferralDiscount` (no change to the wire format) — UX-only addition.
