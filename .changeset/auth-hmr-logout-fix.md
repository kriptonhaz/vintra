---
"@vintra/web": patch
---

Fix dev-mode logouts triggered by Vite HMR clearing auth cookies.

`use-auth.ts` was wiping `sb-access-token` + `sb-refresh-token` on any `onAuthStateChange` event with a null session. Supabase fires `INITIAL_SESSION(null)` briefly while it loads the session from `localStorage` — every time HMR re-mounted the auth provider in dev, that null event blew away the cookies before the real session resolved a frame later. Next navigation then hit the server middleware with no auth and bounced to `/auth/login`.

Now we only clear cookies on the explicit `SIGNED_OUT` event. Other null events leave cookies in place; the server middleware re-validates on every request anyway, so stale cookies aren't a security risk — they're a recovery path.

Same fix in prod helps users whose tab was idle long enough for supabase-js to emit a transient null event during a refresh hiccup.
