---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Make the referral program an admin-curated allowlist with per-tenant caps.

Previously every tenant could create referral codes, all sharing one global cap. The program is now curated: a tenant can run a referral program (create codes, view pendaftar, claim commissions) only when a platform admin has enabled it, and each enabled tenant gets its own discount + commission cap.

- New `tenant_referral_settings` table (`enabled` + `cap_pct` per tenant). Seeded with Mantra Maker and DigitalContent (the two tenants with existing codes), both at a 20% cap.
- New `requireReferralAccess` middleware gates all tenant-facing referral server functions; `getReferralCap` and code create/update now use the per-tenant cap instead of the global one.
- Off-allowlist tenants no longer see the Referral sidebar entry, and a direct hit to `/referrals` redirects to the dashboard.
- Admin can toggle access + set the cap on a new "Akses Referral" card on the tenant detail page; a read-only `/admin/referrals/access` page audits every tenant's status.
- Disabling a tenant freezes their referral codes (`is_active = false`); existing attributions and commissions are grandfathered so referees keep their discount and the referrer keeps earning through the attribution window.
- Being referred (signing up with someone else's code) stays universal — the allowlist only controls who can run a program, not who can be referred.
