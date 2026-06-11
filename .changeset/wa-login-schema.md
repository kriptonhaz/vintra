---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Schema groundwork for WhatsApp OTP staff login (PR 1 of the series). Adds `wa_login_otps` (short-lived 6-digit codes, argon2id-hashed, 5-minute TTL), `wa_instances.otp_login_enabled` (per-instance owner toggle), `tenant_members.wa_login_enabled` (per-member opt-in), and `tenant_members.wa_login_email` (synthetic Supabase email for phone-only staff). All additive — existing rows keep current behavior until owners flip the new flags. No runtime code wired up yet; the inbound detector, HTTP endpoints, and login UI ship in subsequent PRs.
