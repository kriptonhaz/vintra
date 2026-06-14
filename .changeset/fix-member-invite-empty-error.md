---
"@vintra/web": patch
---

Fix "Tambah Anggota" (add team member) failing with an opaque `{}` error. The email invite path used Supabase's `inviteUserByEmail`, which relies on Supabase's hosted SMTP — rate-limited in this project, so it failed with an empty-body error that surfaced as `{}`. Migrated the invite to the same pattern registration/password-reset already use: `admin.generateLink({ type: 'invite' })` (no Supabase email) + delivery via the Brevo pipeline with a branded invite template. The activation link is also returned and shown to the owner with a copy button as a manual fallback. Error messages now use `||` + include the error code instead of passing an empty string through.
