---
"@vintra/web": patch
---

Fix invite / password-reset links pointing to http://localhost:3000. The redirect URL fell back to localhost when the server's VITE_APP_URL wasn't set, so member/staff invite emails (and password-reset links) landed on localhost. A new getAppOrigin() helper derives the real public origin from the request (Host + X-Forwarded-Proto behind nginx), with VITE_APP_URL as an override — so links now correctly point at https://vintra.my.id. Applied to member invites, staff invites, signup verification, and password reset.
