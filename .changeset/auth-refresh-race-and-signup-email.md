---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix two auth bugs surfaced in production:

- Coalesce concurrent Supabase refresh-token calls so two server functions firing on the same page no longer race and silently log the user out with "Invalid Refresh Token: Already Used".
- Route signup verification email through the existing Brevo integration instead of Supabase's rate-limited hosted SMTP, eliminating the "Error sending confirmation email" failure on register.
