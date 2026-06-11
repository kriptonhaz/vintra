-- JUR-166: Add booking.read + booking.write permissions and grant to system roles.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running is safe.

INSERT INTO permissions (key, label, module) VALUES
  ('booking.read',  'Lihat Booking',  'booking'),
  ('booking.write', 'Kelola Booking', 'booking')
ON CONFLICT (key) DO NOTHING;

-- Grant matrix:
--   owner      → both (via 'all')
--   admin      → both (via 'all-except-settings-manage')
--   supervisor → both (oversees operations)
--   staff      → none
--   cashier    → none

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE
  (r.key IN ('owner', 'admin') AND p.key IN ('booking.read', 'booking.write'))
  OR (r.key = 'supervisor' AND p.key IN ('booking.read', 'booking.write'))
ON CONFLICT DO NOTHING;
