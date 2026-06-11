---
"@vintra/web": minor
"@vintra/shared": patch
---

Add account settings page at `/settings/account` letting logged-in users change their password. For users who only signed up via Google OAuth, the same page offers a "Set Password" form that creates an email/password identity so they can sign in either way. Server verifies the current password before allowing a change.
