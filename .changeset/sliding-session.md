---
"@vintra/web": minor
---

Sliding session: active users stay logged in indefinitely; idle users expire after the cookie window.

**Bug being fixed**

The server-side auth middleware refreshes the access token when it sees an expired one but never wrote the new pair back to cookies. With Supabase's default refresh-token rotation enabled, that left cookies pointing at a now-invalidated refresh token — the *next* request failed and booted users mid-session, often within the same day. Disabling rotation in the Supabase Dashboard mitigates the symptom; this change closes the architectural gap.

**What changed**

- New `apps/web/src/lib/session-cookies.ts` — single source of truth for cookie names + max-age (90 days).
- `apps/web/src/server/middleware/auth.ts` and `apps/web/src/server/functions/auth.ts`: after a successful server-side `refreshSession()`, the new access + refresh tokens are written back via TanStack Start's `setCookie`. This (a) keeps the cookies valid even with rotation enabled and (b) resets the cookie max-age countdown — so an active user who only ever hits SSR pages still gets a fresh sliding window.
- `use-auth.ts` and the three auth routes (`login`, `register`, `callback`) now import the shared constant instead of duplicating the literal in five places.
- Cookie max-age bumped from 30 → 90 days.

**Net behaviour**

- Active user (browser-side supabase-js auto-refresh OR server-side middleware refresh on a request) → cookies are rewritten with a fresh 90-day max-age. Effectively never logged out as long as they keep using the app.
- Idle user (no refresh on either side for 90 days) → cookies expire, next visit goes to login. Matches the "expire after inactivity" intent.
- The Supabase-side **Inactivity timeout** (Dashboard → Authentication → Sessions, Pro plan) takes precedence if set lower; cookie max-age must be ≥ that value.
