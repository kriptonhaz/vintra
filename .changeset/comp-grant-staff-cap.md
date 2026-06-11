---
"@vintra/web": patch
---

Fix: a comp grant on the attendance module now resets `billed_staff_count` on both the INSERT and UPDATE paths of the upsert. Previously only the INSERT side set it to 999 (effectively unlimited); the UPDATE side left it alone, so a tenant whose `attendance_settings` row already existed from a prior trial or activation kept its old `billed_staff_count` (often 0) and the seat guard rejected every add-staff attempt with "Kuota staf untuk modul Absensi belum ditetapkan." Same fix applied to the all-modules branch.
