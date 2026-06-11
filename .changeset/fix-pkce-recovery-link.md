---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix multi-user "Cloudflare error" reports on password-reset link — the actual bug was our reset-password page silently ignoring Supabase's PKCE-flow recovery URL format (`?code=…`).

The Supabase project's email auth is set to PKCE flow, so `admin.generateLink({ type: 'recovery' })` issues links that redirect to `/auth/reset-password?code=<uuid>` instead of the legacy `#access_token=…&type=recovery` hash. Our page handled the hash form (via `setSession`) and the expired form (`?error_code=otp_expired`) but had no branch for `?code=`. The code sat there, no `PASSWORD_RECOVERY` event ever fired, and the page fell through to the 4-second timeout → generic "Link Tidak Valid" screen. Users described this as a "Cloudflare error" because that's the term they had picked up from earlier issues, but nginx logs confirmed every request returned HTTP 200 — origin was healthy the whole time.

Fix:

- **reset-password page** now reads `?code=` from the URL and calls `supabase.auth.exchangeCodeForSession(code)`. Success → `ready` (show the new-password form). Failure → `expired` (same UI as the explicit `otp_expired` branch). URL is scrubbed after exchange so a refresh / bookmark doesn't re-attempt the one-time code.
- **Apex defensive redirect** (`/`) also forwards `?code=` to `/auth/reset-password` so a Site-URL fallback (when the Supabase redirect allowlist is mis-configured) still routes the user correctly.
- Legacy `#access_token=…` hash handling stays in place for back-compat.
