---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix three auth UX issues surfaced by Es Teh Paus Pusat (and similar tenants):

- **Reset-password page now handles Supabase's `?error_code=otp_expired`
  redirect.** Previously, when a user clicked an expired recovery link
  Supabase would redirect to `/auth/reset-password?error=access_denied&error_code=otp_expired&...`
  and our page would ignore the query string, spin for 4s, then show a
  generic "invalid link" message. Users misread this as a Cloudflare
  error. We now read the search params upfront, render a clear
  "Link expired" state with a one-click CTA to request a new link.
- **Login page now detects Google-SSO-only accounts on failed password
  attempts.** When `signInWithPassword` returns "Invalid credentials"
  we probe `auth.users.raw_app_meta_data->providers` via a new
  `checkLoginAuthMethod` server fn. If the user's only provider is
  Google, we show "Akun ini terdaftar dengan Google" pointing them at
  the Google button instead of letting them loop on a password they
  never set. (6 of 9 Es Teh Paus Pusat members are Google-only.)
- **Password reset emails now go through Brevo, not Supabase SMTP.**
  Same rationale as the earlier signup-email switch: Supabase's hosted
  mailer was rate-limited. New `sendPasswordResetEmail` server fn
  calls `admin.generateLink({ type: 'recovery' })`, extracts the
  action URL, and delivers via our Brevo helper using the new
  `buildPasswordResetEmail` template. Forgot-password page no longer
  calls `supabase.auth.resetPasswordForEmail` directly. Anti-enumeration
  is preserved — we always return `{ ok: true }` regardless of whether
  the email exists.
