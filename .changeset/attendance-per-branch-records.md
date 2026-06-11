---
"@vintra/web": minor
"@vintra/db": patch
---

Multi-outlet supervisors now record attendance per-(staff, branch, day) instead of per-(staff, day). A supervisor assigned to multiple outlets can clock in/out independently at each one; open clock-ins at other branches do not block.

- DB constraint swap: `attendance_records_staff_date_unique` → `attendance_records_staff_branch_date_unique`. Migration 0123 is idempotent (the constraint is applied out-of-band via Supabase MCP).
- `getMyTodayStatus`, `submitClockIn`, `submitClockOut` now key the duplicate-check by `(staffProfileId, branchId, date)`. Error messages name the branch ("Anda sudah clock-in di Outlet A hari ini").
- `getMyTodayStatus` returns a new `accessibleBranches: { id, name, isMain, status }[]` array for every branch the caller may operate. Single-branch staff get a list of one (UI quietly hides the chip strip).
- New web chip strip on `/attendance/check-in` for multi-outlet supervisors: per-branch status badge (`✓` clocked-out / `⏱` clocked-in / `⏳` pending). Tapping a chip switches the topbar branch.
- `getMyAttendanceHistory` LEFT JOINs branches so mobile + web history can label rows with their outlet name.
- Mobile history screen now groups by date with per-branch sub-rows; capture screen passes the active outlet through to the server fns.
- Single-branch staff behavior is unchanged.
