---
"@vintra/web": minor
---

Add platform-admin tenant deletion. A new "Zona Berbahaya" section on
`/admin/tenants/$tenantId` lets platform admins permanently delete a
tenant after typing the business name to unlock the button. The delete
transaction cleans up all tenant-scoped rows (HPP + members +
categories; attendance tables auto-cascade), then removes auth users
that no longer have memberships anywhere (owners who also belong to
other tenants are preserved). Every deletion is recorded in
`platform_admin_audit_logs` with action `tenant_delete` and a metadata
snapshot of the removed tenant.
