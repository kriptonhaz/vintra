---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Attendance module trial (admin-triggered, one-time per tenant).

Platform admin can now start a free trial for the Attendance module
from the tenant detail page — defaults to 3 days / 2-staff cap, both
overridable at start. Trial state lives on new columns of
`attendance_settings` (`trial_started_at`, `trial_ends_at`,
`trial_staff_cap`, `trial_used`). `trial_used=true` is the one-time
gate; a second trial requires platform-admin DB intervention.

During a trial:
- Module access is granted (module-access guard now allows paid OR trial)
- Staff invite cap = `trial_staff_cap` (replaces `billed_staff_count`)
- Dashboard plan label reads "Trial · X hari lagi"
- Billing page + admin finance show a distinct brand-colored "Trial"
  pill on the transaction row; refund action is hidden on trial rows
- `/admin/finance` summary is unaffected (trial rows have amount=0)

Admin can extend or shorten a running trial (new end date / cap),
audited. Admin can also end a trial early; tenant is bounced to
`/attendance/locked` with a trial-specific "Masa Trial Telah Berakhir"
message on the next request.

Trial conversion: the existing "Aktifkan" payment flow on the tenant
detail page works unchanged — admin picks a paid plan, records a
payment, and the subscription takes over. Staff added during trial
stay put; the trial transaction row stays in the ledger for history.

Shared constants: `ATTENDANCE_TRIAL_DEFAULTS` (3 days / 2 staff) and
`TRIAL_PLAN` (with `plan_key='attendance_trial'`) live in
`@vintra/shared`. Naming is module-scoped so POS / Inventory can
add their own trials later without a premature per-module abstraction.

Audit log gains three new action types:
`attendance_trial_start` (green), `attendance_trial_update` (brand),
`attendance_trial_end` (amber).
