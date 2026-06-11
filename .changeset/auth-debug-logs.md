---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Diagnostic logs for the idle-logout investigation.

The auth-bounce-after-hours-idle issue isn't reproducible on demand and the existing code defends every failure path I can reason about. Add structured `[auth]`-prefixed logs in `requireAuth` so the next reproduction tells us exactly which branch broke instead of guessing:

- No access-token cookie at all
- Access token rejected (with the supabase error message)
- No refresh-token cookie to fall back on
- Refresh attempt + outcome (success with user id, or failure with error message + HTTP status)

Logs never include the actual token bytes — only presence / supabase-side error messages.

Pull from the box with `pm2 logs vintra-web | grep '\[auth\]'` after a reproduction.
