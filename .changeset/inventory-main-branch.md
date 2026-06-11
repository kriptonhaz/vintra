---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

Inventory branches model overhaul: lift Cabang to top-level, drop branch caps from paid tiers, Free locks to a single user-chosen "main branch."

**Why** — branches are a tenant-wide resource (already shared between attendance and inventory) but the per-tier branch caps (Free 1 / Toko 2 / Bisnis 3 / Multi-Outlet ∞) conflicted whenever an attendance-paid tenant also had Free inventory. The cap was either leaky or confusing depending on the path. New model: branches are tenant-wide, paid inventory tiers have unlimited branches, and Free inventory locks to one user-chosen branch.

**Pricing**
- `INVENTORY_PLANS`: Toko / Bisnis / Multi-Outlet / Trial all set to `branchCap: null` (unlimited). Free stays at 1.
- Landing + billing tier cards: paid tiers say "Semua cabang"; Free says "1 cabang utama". Multi-Outlet differentiation is now purely Phase 3 features (inter-outlet transfer, consolidated reports).

**Schema**
- New `main_branch_id` column on `inventory_settings` (FK → branches with `ON DELETE SET NULL`). Migration `0015_inventory_main_branch.sql` auto-back-fills the oldest active branch for existing tenants.

**Server**
- `ensureMainBranchId(tenantId)` — lazy default on first inventory access; no forced setup modal.
- `assertBranchAllowedForTier()` guard inside `recordMovement` — Free tenants writing stock at a non-main branch get a friendly upgrade error.
- New `setInventoryMainBranch({ branchId })` server fn for the dashboard picker.
- `getInventoryOverview` returns `mainBranch: { id, name }` inline.
- `listInventoryFormMasters` filters branches to the main one for Free tier (movement form picker hides others automatically).
- `deleteBranch` (attendance-branches.ts) now refuses if the branch is anyone's `mainBranchId` or has any inventory stock balances — prevents silent data loss.

**Sidebar / routing**
- Moved `apps/web/src/routes/_authed/attendance/branches.tsx` → `apps/web/src/routes/_authed/master/branches.tsx` (top-level under Data Master). Removed the `<AttendanceSubnav />` from it.
- Old `/attendance/branches` and `/inventory/branches` paths replaced with redirect stubs to `/master/branches`.
- `MASTER_DATA_NAV` gets a "Cabang" entry (Building2 icon, gated by `attendance.manage`).
- Removed the "Cabang" tab from both inventory and attendance subnavs.

**Dashboard**
- New "Cabang Utama" card on `/inventory` with branch name + "Ubah" button. Free tier shows the lock-in hint copy. Picker is a small dialog over `listBranches` + `setInventoryMainBranch`.
