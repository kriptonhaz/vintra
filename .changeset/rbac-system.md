---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add DB-backed RBAC system: global `roles`, `permissions`, `role_permissions` tables; `tenant_members.role_id` FK; `seed:rbac` script seeding default roles (owner, admin, supervisor, staff, cashier) and 18 action-level permissions; `requirePermission()` middleware helper; admin pages for managing roles + permissions; tenant owner self-serve member invite + role assignment at `/settings/members`.
