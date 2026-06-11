---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

`/auth/login` and `/auth/register` now skip the form when the caller
already has a valid session. `getCurrentUser()` runs in `beforeLoad`;
non-null result → redirect to `/dashboard` (or `/onboarding` if the
tenant hasn't completed onboarding). Stops the "I look logged out but
I'm not" UX where a stale `/auth/login` URL forces the owner to retype
their password despite a working session.
