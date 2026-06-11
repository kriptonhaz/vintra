---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix two issues on the password-recovery flow:

- **Recovery hash now actually sets a session.** Our browser Supabase
  client is configured with `flowType: 'pkce'` (the modern OAuth
  path), which ignores `#access_token=…` hash fragments entirely —
  the recovery email's implicit-flow hash never produced a
  `PASSWORD_RECOVERY` event, so we'd fall into the 4 s timeout and
  show "Link Tidak Valid" even on a freshly-clicked valid link. The
  reset-password route now manually parses the hash and calls
  `setSession()` with the token pair, then clears the hash from the
  URL bar. The "expired" branch still catches `?error=otp_expired`.
- **Forgot-password and reset-password redesigned to match brand
  theme.** Swapped the placeholder JQ tile for the real logo image,
  switched all `primary-*` colors to `brand-*` (the app's green),
  bumped to `rounded-2xl` cards with shadow, added Mail / Clock /
  AlertCircle / CheckCircle2 iconography on each stage, and added
  dark-mode classes so the pages match login.tsx visually.
