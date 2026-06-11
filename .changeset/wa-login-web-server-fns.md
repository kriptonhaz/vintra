---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — web server functions + Supabase magic-link minting (PR 4 of the series). Adds `apps/web/src/server/functions/wa-login.ts` with:

- `requestWaLoginOtp({ tenantSlug, phone })` — proxies the public `/v1/auth/wa-login/request` endpoint. No Supabase cookies forwarded.
- `verifyWaLoginOtp({ tenantSlug, phone, otp })` — calls the API verify endpoint, then mints a Supabase session via `supabase.auth.admin.generateLink({ type: 'magiclink' })` + `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`. Returns `{ accessToken, refreshToken }` so the login UI can set sb-access-token / sb-refresh-token cookies via the same browser-side path as email/password login. Phone-only staff use the synthetic `wa_login_email` returned by the API; staff with real emails get resolved through `admin.getUserById`.

Also adds `normalizeIDPhone()` + Zod schemas to `@vintra/shared` — byte-equivalent with the Go `walogin.NormalizeIDPhone` in PR 2, so both ends of the flow produce the same canonical "62XXXXXXXXXX" string for DB lookup. UI ships in PR 5.
