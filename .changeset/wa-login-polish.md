---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — polish (PR 7, final of the series).

**Phone-only invite UI.** `/settings/members` Undang sheet now offers a "Tipe Undangan" radio at the top with two modes:
- *Email + Password* — the existing path; email required, phone optional.
- *WhatsApp (tanpa email)* — phone required (the email field is hidden), no photo upload. Submit routes through `invitePhoneOnlyTenantMember` from PR 6. The server generates a synthetic Supabase email and flips `wa_login_enabled` on so the new member can log in immediately via the tenant's WA login URL.

**Audit log.** API `walogin.Service.VerifyAndConsumeOtp` emits a structured `slog.Info` line on every successful verify carrying tenant_id, member_id, user_id, normalized phone, and a synthetic_email flag. Lands in the same log stream as the rest of the API so existing shippers pick it up. OTP plaintext is never logged anywhere.

**Boot-time OTP cleanup.** New `DeleteStaleWaLoginOtps` query deletes consumed-or-expired rows older than 30 days. A fire-and-forget goroutine in `cmd/api/main.go` runs it on every process start — good enough for a table that grows ~10s of rows per tenant per day. Wrapped in `safego` so a panic doesn't crash boot.

(Prometheus counters mentioned in the original plan are deferred — the project has no metrics infrastructure yet; adding it is its own multi-PR effort.)
