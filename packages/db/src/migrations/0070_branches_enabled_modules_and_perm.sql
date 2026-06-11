-- Branches go from "physical location used by all 3 modules" to a
-- per-module-toggled primitive: each branch knows which modules are
-- active at it. A gudang is a Branch with only Inventory ON; a
-- franchise outlet has all 3. Cost preview + admin reconciliation
-- read this column to size the per-module additional-location fees.
--
-- Default = ARRAY['pos','inventory','attendance'] preserves the
-- status quo for every existing row — they're already treated as full
-- outlets by every module that joins on branch_id today.
ALTER TABLE "branches"
  ADD COLUMN "enabled_modules" text[] NOT NULL
  DEFAULT ARRAY['pos','inventory','attendance']::text[];

-- Tenant-level branch management is no longer attendance-gated. POS-
-- only and Komplit tenants who don't use attendance still need to add
-- gudang/outlet locations. New permission key + auto-grant to the two
-- system roles that already had `all` / `all-except-settings-manage`.
INSERT INTO permissions (key, label, module) VALUES
  ('branches.manage', 'Kelola Cabang/Outlet', 'master')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.key IN ('owner', 'admin')
  AND p.key = 'branches.manage'
ON CONFLICT DO NOTHING;
