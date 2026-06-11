-- JUR-84: Add whatsapp.read + whatsapp.manage permissions and grant
-- them to the system roles that should have them by default.
--
-- Why a migration (not just rerunning seed-rbac.ts): existing prod
-- tenants already have role_permissions populated; we need the new
-- permission grants applied without manual intervention. The seed
-- script is dev-only.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running the migration
-- harness is safe.

-- 1. Catalog rows
INSERT INTO permissions (key, label, module) VALUES
  ('whatsapp.read',   'Lihat WhatsApp',     'whatsapp'),
  ('whatsapp.manage', 'Kelola WhatsApp',    'whatsapp')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant matrix.
--    owner      → both     (matches seed-rbac.ts 'all')
--    admin      → both     (matches seed-rbac.ts 'all-except-settings-manage')
--    supervisor → read only (oversees operations; can view chats but not pair/delete instances)
--    staff      → none     (default — admin can grant via /admin/roles if needed)
--    cashier    → none     (same)
--
-- We don't touch tenant-defined custom roles; they keep whatever
-- the tenant admin explicitly granted (usually nothing for WA).

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE
  (r.key = 'owner'      AND p.key IN ('whatsapp.read', 'whatsapp.manage'))
  OR (r.key = 'admin'   AND p.key IN ('whatsapp.read', 'whatsapp.manage'))
  OR (r.key = 'supervisor' AND p.key = 'whatsapp.read')
ON CONFLICT DO NOTHING;
