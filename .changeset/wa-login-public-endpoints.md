---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — public HTTP endpoints (PR 3 of the series). Adds two unauthenticated routes on the Go API:

- `POST /v1/auth/wa-login/request` — resolves a tenant slug to its connected, paid-tier, OTP-enabled WhatsApp instance and returns a wa.me deep link. Does NOT generate an OTP; that only happens when an inbound WhatsApp message arrives at the tenant's instance (preserves the ban-safe "user-initiated conversation" property).
- `POST /v1/auth/wa-login/verify` — validates a user-submitted 6-digit code against the latest unconsumed unexpired OTP for the (tenant, phone) pair. On match, consumes the row atomically (FOR UPDATE) and returns the staff identity (`userId`, optional synthetic `authEmail`, `tenantId`) for the web layer to mint a Supabase session.

Per-phone verify rate limit (5/hour, Redis fixed-window) caps online brute-force, working alongside the per-OTP 3-attempt cap that already kills the row after the third wrong guess. Both endpoints return identical generic errors for "tenant unknown" / "feature unavailable" / "phone not registered" / "wrong code" so phone+tenant enumeration leaks nothing.
