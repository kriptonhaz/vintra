---
"@vintra/web": minor
---

Merge the `/attendance/staff` page into `/settings/members` and `/attendance/shifts`. The standalone staff page is removed (and its sidebar entry) since a staff record is just the HR extension of a tenant member.

- `/settings/members`: the invite and edit sheets gain an optional, collapsible "Data Absensi (HR)" section (home branch, NIK, employee number, position, joined date, base salary). Setting a home branch registers the member as attendance staff.
- `/attendance/shifts`: clicking a shift opens a panel to add/remove its staff, and a "Staff without a shift" card surfaces unassigned staff in the selected branch.
- `/attendance/billing`: a new "Active Staff Quota" section lists staff with active/inactive toggles so owners choose which staff occupy the paid seats.
