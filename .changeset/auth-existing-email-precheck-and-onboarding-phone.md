---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Two auth/onboarding improvements:

- **fix(auth):** pre-check `auth.users` for an existing row before calling `admin.generateLink({type:'signup'})`. Without this, Supabase silently re-issues a verification link for already-present (e.g. invite-flow) emails WITHOUT updating the typed password — the user would confirm and then be unable to log in because the stored hash was the old one. Now we throw "Email sudah terdaftar" up front.
- **feat(onboarding):** add a required "Nomor HP / WhatsApp" field on the onboarding form. Phone is persisted to `tenant_members.phone` for the owner (column already existed). Better tenant contact info; renders alongside the rest of the owner profile in the existing Anggota Tim view.
