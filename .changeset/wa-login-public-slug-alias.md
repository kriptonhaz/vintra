---
"@vintra/web": minor
---

The staff WhatsApp-login URL now accepts the tenant's `public_slug` vanity alias in addition to the auto-generated `tenants.slug`. An owner can claim a memorable name (e.g. `usama-steam`) and staff visit `vintra.my.id/auth/wa-login/usama-steam` instead of `…/syamsuddin-cahaya-mpbv7w5v`. The internal `slug` stays as the stable identifier — synthetic Supabase emails (`wa-{slug}-{phone}@login.vintra.local`) keep using it, so existing WA-login accounts are unaffected.

The slug-claim API (`claimPublicSlug`) drops the situs-feature gate so non-Komplit tenants can claim a login alias too; permission is now `settings.manage` (owner-only). The team-members page (`/settings/members`) gains an inline "Ubah URL" editor on the existing WhatsApp-login-link card.
