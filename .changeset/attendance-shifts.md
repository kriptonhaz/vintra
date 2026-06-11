---
"@vintra/web": minor
"@vintra/db": patch
---

Attendance: named shifts per branch.

Owners can now define multiple shifts per branch (e.g., "Pagi",
"Malam") — each with its own weekly schedule — and assign individual
staff to a shift. Staff on a shift check in against that shift's
schedule (status, grace minutes, working days); staff without a shift
continue to use the branch default schedule exactly as before — no
migration needed for existing tenants.

Also includes:
- New `/attendance/shifts` page with branch selector, shift list,
  create/edit/delete, and a weekly schedule editor. Shifts with active
  staff or historical records cannot be hard-deleted; use the active
  toggle to archive instead.
- Shift picker added to the staff form (defaults to Regular); shift
  column and filter added to the records page + CSV/XLSX exports (with
  "Reguler" as the label for unshifted records).
- `attendance_records.branch_shift_id` column — snapshotted at
  clock-in time so history stays attributable when shifts are renamed
  or reassigned.
- Fixes pre-existing clock-out grace bug: `submitClockOut` was
  hardcoding `0` for early-leave grace instead of reading the
  staff's effective `earlyLeaveGraceMinutes`.

Constraint for v1: shifts must start and end on the same calendar day
(enforced by a CHECK constraint on `branch_shift_schedules`).
Cross-midnight night shifts (e.g., 22:00 → 06:00) are deferred to a
future change that will also handle business-date attribution.
