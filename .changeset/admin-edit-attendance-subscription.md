---
"@vintra/web": patch
---

Add an "Edit" button to the admin attendance-module section on
`/admin/tenants/$tenantId`. Platform admins can now update a tenant's
subscription expiry date and billed staff count without having to
deactivate and reactivate the module. New server function
`updateAttendanceSubscription` writes an `attendance_update` row to
`platform_admin_audit_logs`.
