---
"@vintra/web": patch
---

Fix `Anggota` column showing `0` for every row in the admin tenant list.

Drizzle's `${column}` interpolation inside a `sql` template renders
column references **unqualified**. In `listTenants` the correlated
subquery `where ${tenantMembers.tenantId} = ${tenants.id}` became
`where "tenant_id" = "id"` — PostgreSQL resolved both identifiers
against the subquery's `tenant_members` table, so the condition was
effectively `tenant_members.tenant_id = tenant_members.id` which is
never true and always returned `0`.

Fix by hand-qualifying both sides of the comparison with their table
names so the outer `tenants.id` actually correlates.
