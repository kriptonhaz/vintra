---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix referral page table headers: route through proper i18n keys instead
of hardcoded Indonesian. Adds a `referrals` namespace
(`colCode` / `colLabel` / `colDiscount` / `colCommission` /
`colAttributions` / `colStatus`) plus `common.actions` (reusable
across other tables that need it), and renders all column headers
+ the Edit aria-label via `t()`.
