---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — normalize `tenant_members.phone` at the storage boundary so the inbound detector can use a direct SQL equality lookup instead of the O(N) Go-side scan.

**Schema.** Migration `0074` runs a plpgsql backfill that rewrites every existing phone to the canonical `62XXXXXXXXXX` E.164 form (logic mirrors `walogin.NormalizeIDPhone` and `normalizeIDPhone` exactly). Rows that are out-of-range or unparseable are left as-is — same failure mode they had under the old scan. Also adds partial index `tenant_members_wa_login_phone_idx (tenant_id, phone) WHERE wa_login_enabled = true` so the new lookup is O(log N) over the opt-in subset.

**App side.** New `coerceStorablePhone()` helper in `@vintra/shared` (normalize-or-keep-trimmed-original; never wipes valid input). Wrapped at every `tenant_members.phone` write path:
- `inviteTenantMember`, `updateTenantMemberProfile` (tenant-members.ts)
- `createStaffProfile` (×2 paths) (attendance-staff.ts)
- `completeOnboarding` (auth.ts)

`invitePhoneOnlyTenantMember` already normalized via `normalizeIDPhone` strict (rejects malformed) so no change there — that path is WA-login-specific and stricter on purpose.

**Detector.** Replaces `ListOptInTenantMembersByTenant` + Go-side scan with new `GetOptInTenantMemberByPhone` query — direct `(tenant_id, phone)` equality lookup backed by the partial index. ~1ms p99 regardless of staff count, vs. the prior linear scan.
