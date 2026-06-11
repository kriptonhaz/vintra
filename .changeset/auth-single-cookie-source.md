---
"@vintra/web": patch
---

Fix: spurious logouts caused by dual cookie sets racing on refresh.

The browser used `@supabase/ssr`'s `createBrowserClient`, which writes its OWN session cookies (`sb-<project>-auth-token.0`, `.1`, etc.). The server middleware reads `sb-access-token` / `sb-refresh-token` — a separate pair maintained by `setTokenCookies` in the auth listener. **Two parallel cookie sets** that could fall out of sync.

With Supabase's refresh-token rotation enabled, the lag between `@supabase/ssr` rotating its cookies and our manual `setTokenCookies` mirroring the new token to `sb-access-token` was long enough that:

1. Browser supabase-js detects expired access token, refreshes via Supabase API, rotates the refresh_token (old one invalidated)
2. Server's next request reads the still-stale `sb-access-token`, tries to refresh with the still-stale `sb-refresh-token` cookie
3. Supabase rejects with "refresh_token_already_used"
4. Server returns null user → user bounced to `/auth/login`

**Fix**: dropped `@supabase/ssr`'s `createBrowserClient` in favour of plain `@supabase/supabase-js` `createClient` for the browser. Now:
- Browser stores session in localStorage (the supabase-js default)
- The existing `onAuthStateChange` handler in `use-auth.ts` mirrors every token refresh into our manual `sb-access-token` / `sb-refresh-token` cookies
- The server reads the same cookies
- One refresh path, no rotation race, no dual cookie sets

`detectSessionInUrl: true` + `flowType: 'pkce'` preserve the OAuth callback handling that `/auth/callback` relied on.

Symptom: in dev (and sometimes prod), users got bounced to `/auth/login` mid-session, especially after the access token's TTL elapsed (~1 hour by default). Should now stay logged in indefinitely as long as the refresh token is valid.