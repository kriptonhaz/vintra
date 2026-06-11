---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix silent logout after hours of idle by eliminating the remaining refresh-token races.

Three changes, all in the auth/refresh path:

1. **Disable browser-side `autoRefreshToken`.** Browser supabase-js was running its own background refresh timer in parallel with the server middleware's refresh. Both consume the same single-use refresh token — whichever lost the race got `Invalid Refresh Token: Already Used` and the user bounced to login. Since every data path in this app goes through TanStack server functions (which always invoke `requireAuth`), the browser never needs to refresh on its own. The server is now the sole refresh authority; the bootstrap in `use-auth.ts` calls `setSession()` once on mount to align supabase-js's in-memory session with whatever the cookies say.

2. **Wrap `supabase.auth.refreshSession()` in try/catch inside the coalescer.** `refreshSession()` *throws* (rather than returning `{error}`) on `AuthRetryableFetchError` / network blips. The previous `.then(res => res)` chain didn't catch throws, so transient failures escaped out of `requireAuth` without firing the "refresh FAILED" log line — exactly what we saw in `pm2 logs` ("trying refresh" with no follow-up). Throws are now normalised into `{error: { name: 'RefreshSessionThrew', ... }}` so the middleware always logs an outcome.

3. **Extend the coalescer success-cache from 1.5s to 30s.** The original 1.5s window handled in-burst concurrent server requests but missed the case where request B arrived AFTER request A rotated the token — B still carried the OLD refresh cookie (Set-Cookie hadn't propagated to the browser yet), saw no in-flight entry, and tried to refresh with the now-consumed token. The 30s window covers that propagation gap. Failures evict immediately so retries can attempt fresh — we never cache a known-bad outcome.

The middleware log line now includes `source=cache|fresh` so we can verify the cache is actually doing work in production logs.
