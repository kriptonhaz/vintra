---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add internal marketing commission system: Vintra's own marketing team (members of an internal tenant) earn commission for referring paying tenants, with a head→staff hierarchy and a cap-allocation tree (global cap → head cap → per-staff budget + head override → discount + commission). Includes the agent dashboard (codes, referrals, commission, withdrawal), head team-management UI, admin marketing console, and agent payouts surfaced in the existing claims queue. Runs alongside the existing tenant-to-tenant referral via a shared, owner-abstracted pipeline.

Also fixes two latent bugs in the referral attribution writer (silently swallowed by its best-effort handler): a `42P18` type-inference failure on the `maxClaims` param under the Supabase pooler, and a Date-binding failure in the raw `sql` template — both now use explicit casts / ISO strings.
