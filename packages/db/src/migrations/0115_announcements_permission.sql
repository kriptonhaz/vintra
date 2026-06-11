-- Pengumuman: add the announcements.manage permission and grant it to
-- the roles that author broadcasts. Mirrors 0048_whatsapp_permissions.sql
-- — existing prod tenants already have role_permissions populated, so we
-- apply the new grant via a migration rather than the dev-only seed.
--
-- Reading announcements needs no permission (every member sees them);
-- this gates authoring/deleting only.
--
-- Idempotent: ON CONFLICT DO NOTHING makes re-runs safe.

-- 1. Catalog row
INSERT INTO permissions (key, label, module) VALUES
  ('announcements.manage', 'Kelola pengumuman', 'announcements')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant matrix.
--    owner        → manage  (matches seed-rbac.ts 'all')
--    admin        → manage  (matches 'all-except-settings-manage')
--    supervisor   → manage  (oversees operations)
--    outlet_owner → manage  (runs their outlet, broadcasts to its staff)
--    staff/cashier→ none
-- CROSS JOIN + WHERE naturally skips any role key absent in this DB.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.key = 'announcements.manage'
  AND r.key IN ('owner', 'admin', 'supervisor', 'outlet_owner')
ON CONFLICT DO NOTHING;
