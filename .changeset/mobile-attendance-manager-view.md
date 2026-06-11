---
"@vintra/mobile": minor
"@vintra/web": patch
---

Mobile Absensi tab now mirrors the web's manager view for tenant owners + admins. Members with `attendance.manage` see today's stats (on-time / late / belum) and a paginated records list scoped to the active outlet — tap a row to expand and view check-in/out photos (with fullscreen viewer) and GPS coords (Google Maps link). Staff without the permission still see the existing check-in flow. Exposes `getAttendanceDashboardStats`, `listAttendanceRecords`, and `listAttendanceStaff` via the mobile gateway.
