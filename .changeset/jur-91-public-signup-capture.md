---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": minor
---

JUR-91: public signup capture for referral codes. Visitors who land on
`/` or `/auth/register` with `?ref=CODE` get the code stored in a 30-day
`jq_ref` cookie. The register form prefills + live-validates the code
on blur (green check / red X / referrer name). On successful tenant
creation the attribution is written transactionally inside
`registerWithEmail` (and `ensureTenantForOAuth` for the Google path);
invalid / inactive / self-referral codes silently no-op so a stale
code never blocks signup. Cookie cleared post-attribution.
