---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — owner UI + control surface (PR 6 of the series).

**WA instance settings (`/whatsapp/$id`).** New "Login Karyawan via WhatsApp" card with the per-instance `otp_login_enabled` toggle. The inbound detector checks this BEFORE running the OTP regex, so disabled instances pay zero runtime cost. Save shares the existing "Simpan Pengaturan" button — one PATCH for AI + handoff + login.

**Members page (`/settings/members`).**
- Emerald info card at the top shows the tenant's WA login URL (`/auth/wa-login/{slug}`) with a one-click "Salin link" copy button — owners share this with staff once.
- New "Login WA" column. Per non-owner member, shows: "Butuh HP" when phone is unset; "Aktifkan" link when phone is set but flag is off; green "Aktif" badge that toggles back off on click when on.

**Server functions.**
- `setTenantMemberWaLogin({ memberId, enabled })` — toggle the per-member flag. Refuses to enable when the member has no phone (server-side enforcement of the same rule the UI shows).
- `invitePhoneOnlyTenantMember({ firstName, phone, roleId, branches, ... })` — creates a Supabase auth user with a synthetic `wa-{slug}-{phone}@login.vintra.local` email, inserts the tenant_members row with `wa_login_enabled=true` + `wa_login_email` populated. UI for this path ships in PR 7.
- `getTenantSlugForWaLogin()` — read-only helper for the copy-URL card.

**API.** The wa_instances PATCH endpoint now accepts `otpLoginEnabled` and the response includes it. `listTenantMembers` now surfaces `waLoginEnabled` + `waLoginEmail` on every row.
