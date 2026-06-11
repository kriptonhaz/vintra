---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add platform-admin impersonation: DB-backed `active_impersonations` (one row per admin, tamper-proof), `platform_admin_audit_logs` for impersonation start/end and admin grant/revoke. Impersonation override is applied inside `requireAuth()` + `getCurrentUser()` so all server functions automatically see the impersonated tenant. Sticky amber banner across `_authed` pages with a one-click "Keluar" button. New `/admin/audit-log` page for reviewing past actions.
