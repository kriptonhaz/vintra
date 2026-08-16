---
"@vintra/web": patch
---

Fix "Gagal masuk dengan Google" on the first login attempt. `createBrowserSupabase()`
returned a fresh `GoTrueClient` on every call, so the global client in
`useAuthProvider` and the per-route client in `/auth/callback` both initialized with
`detectSessionInUrl: true` and raced to exchange the same single-use PKCE `?code=`.
GoTrue rejected the loser as "Possible abuse attempt" (HTTP 400), `SIGNED_IN` never
fired, and the callback timed out — it only appeared to work on a retry when the
timing happened to line up. The browser client is now a per-context singleton, so the
auth code is exchanged exactly once. Also silences supabase-js's "Multiple
GoTrueClient instances detected" warning.
