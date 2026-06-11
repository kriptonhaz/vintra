---
"@vintra/web": minor
"@vintra/shared": minor
---

Attendance trial now runs for 14 days (was 3) and carries no staff cap by default. `ATTENDANCE_TRIAL_DEFAULTS.staffCap = null` means unlimited; the gates (`assertCanConsumeStaffSlot`, `getStaffQuota`) treat null as "no cap" instead of "blocked". Admin TrialSheet gains a "Tanpa batas staf" checkbox so a platform admin can still pin a hard ceiling per tenant if they want one. Locked-page WhatsApp pitch + tenant-detail row updated to read "Tanpa batas".
