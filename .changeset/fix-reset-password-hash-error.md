---
"@vintra/web": patch
---

Fix the set-password page showing a broken form on an already-used invite/reset link. Supabase reports an expired/consumed one-time link via error params in the URL *fragment* (#error=access_denied&error_code=otp_expired), but the page only checked the query string — so a re-opened link slipped through to a stale-session fallback, rendered the form, and failed on submit with "User from sub claim in JWT does not exist". The page now detects the error in both the hash and the query string (and clears any stale session), showing the clear "link expired — request a new one" screen. Submit errors caused by an invalid/stale session route to the same screen.
