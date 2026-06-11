---
"@vintra/web": patch
---

Fix redirect loop for owners whose `tenant_members.role_id` FK is NULL
and tighten the attendance `/locked` page for users without dashboard
access:

- `requireAuth()` and `getCurrentUser()` now fall back to resolving a
  role by its text key (`tenant_members.role`) when `role_id` is null.
  A new owner of "Es Teh Paus Pusat" was stranded because their row
  had `role = 'owner'` but `role_id = NULL`, so the permission
  resolver returned an empty array, the dashboard redirected to
  `/attendance`, attendance redirected to `/attendance/locked`, and
  "Kembali ke Dashboard" looped them back. Resolver is now tolerant.
- `/attendance/locked` page picks its CTA based on whether the user
  has `hpp.read`. Owners / admins keep the "Kembali ke Dashboard"
  link; staff-only accounts (e.g., attendance-only role at a tenant
  that hasn't subscribed) see a **Keluar** button instead of a link
  that would just loop them back here. New `attendance.lockedBodyStaff`
  i18n string explains the situation to them directly.
