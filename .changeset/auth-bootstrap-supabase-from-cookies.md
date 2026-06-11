---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix logout race in dev: the server-side `getCurrentUser` / `requireAuth` middleware refreshes the access-token during SSR and writes the rotated pair into cookies, but the browser-side supabase-js still had the pre-rotation tokens in `localStorage`. When its auto-refresh timer fired it sent the now-dead refresh_token, hit "refresh_token_already_used", cleared its session, and emitted `SIGNED_OUT` — the user appeared logged out even though the cookies were valid.

`useAuthProvider` now bootstraps supabase-js's storage from the cookies on mount (via `setSession`) so its localStorage, in-memory session, and refresh timer all line up with the server's latest tokens.
