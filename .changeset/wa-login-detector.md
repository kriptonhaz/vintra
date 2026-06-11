---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — Go API detector + service (PR 2 of the series). The `wa:incoming` worker now intercepts inbound messages that match the OTP-request pattern (`/\b(otp|login|masuk|kode\s*login)\b/i`, max 60 chars) when (a) the per-instance `otp_login_enabled` flag is on, (b) the tenant subscription is basic+ and active, and (c) the sender's phone resolves to an opt-in `tenant_members` row. On match the worker generates a 6-digit code (crypto/rand), argon2id-hashes it, persists to `wa_login_otps` with a 5-min TTL, and enqueues a `wa:send` task carrying the cleartext reply — piggybacking on the existing send rate limiter so we don't risk a ban. Per-phone request rate limit caps OTP generation at 3/hour via a Redis fixed-window counter. AI auto-reply is skipped for handled OTP requests so customers don't see a stray AI response next to the code. No HTTP endpoints or UI yet — those ship in subsequent PRs.
