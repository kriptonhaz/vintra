---
"@vintra/web": patch
---

Surface the attendance staff quota on the staff page: a badge next to
the "Tambah Staf" button shows `{active} / {billed} staf aktif`,
colored gray under cap, amber at cap, red if over. At-limit or
over-limit tenants also see a warning banner below the page header
explaining what to do (deactivate someone or contact Vintra to
raise the quota). The Add button is disabled at the cap.

Backed by a new `getStaffQuota` server function, loaded alongside
staff/branches/shifts so there's no extra roundtrip.
