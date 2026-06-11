---
"@vintra/web": minor
---

Pengumuman (announcements) — Phase 1. Owners/admins/supervisors can broadcast messages to their staff from a new web admin page (Pengaturan → Pengumuman): compose, list, and delete. Publishing fans out a per-recipient notification (reusing the existing notifications system), so each announcement lands in every member's bell and the mobile home "Pengumuman" card automatically; opening one marks it read.

Adds the `announcements` table (migration `0114`) and the `announcements.manage` permission granted to owner/admin/supervisor/outlet_owner (migration `0115`, mirroring the whatsapp-permissions pattern). Reading needs no permission — every member sees announcements. Mobile gains the home card + a detail screen; the gateway exposes `listAnnouncements`/`getAnnouncement`.
