-- JUR-135: per-member branch scoping. A junction table that pins each
-- tenant_member to one or more branches. Empty rows for a member =
-- access to ALL branches (backward-compatible with pre-JUR-135 data —
-- existing tenants get zero rows and unchanged behavior).
--
-- Owner role always bypasses this check at the application layer; we
-- still allow inserting rows for owner members so the data model
-- stays uniform.

CREATE TABLE IF NOT EXISTS tenant_member_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_member_id uuid NOT NULL REFERENCES tenant_members(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Each (member, branch) pair appears at most once. Toggling a branch
-- off-then-on must INSERT a fresh row but never violate uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_member_branches_member_branch_uniq
  ON tenant_member_branches(tenant_member_id, branch_id);

-- Hot path: requireAuth() reads this by tenant_member_id on every
-- authenticated request.
CREATE INDEX IF NOT EXISTS tenant_member_branches_member_idx
  ON tenant_member_branches(tenant_member_id);

CREATE INDEX IF NOT EXISTS tenant_member_branches_branch_idx
  ON tenant_member_branches(branch_id);
