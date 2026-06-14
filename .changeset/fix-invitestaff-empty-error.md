---
"@vintra/web": patch
---

Apply the same invite fix to `inviteStaff` (attendance staff onboarding): replace Supabase's `inviteUserByEmail` (which fails opaquely as `{}` when Supabase's rate-limited hosted SMTP is unavailable) with `admin.generateLink({ type: 'invite' })` + Brevo delivery, and return the activation link. Keeps staff invites working regardless of Supabase email.
