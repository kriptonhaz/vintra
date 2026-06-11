---
"@vintra/web": minor
---

Add `/auth/reset-password` page that completes the forgot-password flow. The email link from `/auth/forgot-password` now lands here instead of the login page; the page consumes the Supabase recovery token, lets the user set a new password, then signs them out and redirects to login. Previously the link landed on `/auth/login` with no way to actually reset.
