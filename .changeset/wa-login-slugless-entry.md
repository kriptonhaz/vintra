---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff login — slug-less entry point on the main login page. Replaces the passive "ask your owner for the link" hint with an active **"Masuk dengan WhatsApp"** button that goes to a new `/auth/wa-login` landing where staff types their **tenant code** (slug) + phone. On submit the page redirects to the existing slug-specific route with the phone already filled in via `?phone=` search param — the slug page auto-fires the OTP request so staff types phone once, not twice.

Restructured the WA-login routes into a subdirectory (`routes/auth/wa-login/index.tsx` + `routes/auth/wa-login/$tenantSlug.tsx`) to avoid TanStack Router's flat-file layout/leaf ambiguity. URLs are unchanged: `/auth/wa-login` and `/auth/wa-login/{slug}` still work the same.

Deliberately does **not** look up tenant by phone — that would let anyone probe whether a phone is registered staff anywhere on the platform. Staff has to know their tenant code; the owner shares it from `/settings/members`, and the slug-specific bookmarked URL is still the canonical fast path.
