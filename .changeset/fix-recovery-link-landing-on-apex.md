---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Defensive redirect: when Supabase recovery emails land on the apex `/`
instead of `/auth/reset-password` (which happens when the redirect URL
isn't whitelisted in Supabase's URL Configuration), the landing page
now detects the `#type=recovery` hash (or `?error=access_denied&...`
expired-link search params) and bounces to `/auth/reset-password`
preserving the token. The reset-password page already handles both the
recovery flow and the expired-link error state, so the user lands on
something useful instead of staring at the marketing landing with a
valid token they can't use.
