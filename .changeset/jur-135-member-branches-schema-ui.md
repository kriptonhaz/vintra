---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-135 PR 1 — `tenant_member_branches` junction + Owner UI (no enforcement yet):

Lays the foundation for per-member branch scoping. Owners can pin members to specific branches via the invite form and the inline chip editor on `/settings/members`. **No server-side enforcement is wired up in this PR** — assignment data is stored but POS / Inventory still see all branches for everyone. The enforcement layer ships in PR 2 (JUR-135 part 2) so any UI bugs here can't break production cashiers.

**Schema**
- New `tenant_member_branches (id, tenant_member_id, branch_id, created_at)` junction with `UNIQUE (tenant_member_id, branch_id)` + read indexes on both FKs. Lives in its own file to avoid the circular import between `auth.ts` (needs `branches`) and `attendance.ts` (already imports `tenantMembers`).
- Migration `0054_tenant_member_branches.sql`.
- Empty rows for a member = unrestricted ("all branches") — backward-compatible with every existing tenant on deploy.

**Auth**
- `AuthContext.allowedBranchIds: string[] | null` — null when unrestricted (owner role, impersonation, or empty junction), `string[]` when explicitly pinned. `requireAuth` reads the junction in one extra query per authenticated request (skipped for owners).

**Server fns** (`apps/web/src/server/functions/tenant-members.ts`)
- `listTenantMembers` now returns `assignedBranchIds` per row (one batched query, grouped in JS).
- `listTenantBranchesForMembers` — light list for the picker (active branches, main first).
- `inviteTenantMember` accepts a `branches` discriminated union (`{mode:'all'} | {mode:'specific', branchIds[]}`), validates the IDs belong to the tenant, inserts junction rows (skips for owner role).
- `setTenantMemberBranches` — replaces a member's pins in a single transaction. Refuses to mutate owner rows.
- `updateTenantMemberRole` — promoting to owner clears any existing pins so a future demote doesn't silently re-apply out-of-date scoping.

**UI** (`/settings/members`)
- New "Cabang" column on the table (hidden when tenant has ≤1 branch).
- Owner row → locked "Semua cabang" badge.
- Other rows → editable chip ("Cabang BSD ✎" / "3 cabang ✎" / "Semua cabang ✎") opening an inline popover with the same access picker the invite form uses.
- Invite form has a new "Akses Cabang" section: radio (Semua / Cabang tertentu) + checkbox list with main-branch flag. Defaults to "Cabang tertentu" pre-selecting the main branch (per the agreed-upon restrictive default).
- Zod refine + client-side check enforce ≥1 branch OR "Semua cabang" — no member can end up with zero access.
- All new strings localised in id/en.
