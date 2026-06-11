---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Make branches a per-module-toggleable outlet primitive with additive per-location pricing.

**Schema (0070)** — adds `branches.enabled_modules text[] NOT NULL DEFAULT ARRAY['pos','inventory','attendance']` and a new `branches.manage` permission grant to Owner + Admin. Default preserves status-quo behaviour for all existing rows (they're treated as full outlets by every module).

**/master/branches redesign** — decoupled from the attendance module gate (POS-only and Komplit tenants can now reach the page). Each branch carries module toggles (Kasir/Stok/HR); a "Gudang" is a branch with only Stok enabled. The create/edit sheet shows a live cost-preview line ("+ Rp X/bulan akan ditagih pada perpanjangan berikutnya") computed from the new `branchCostBreakdown` helper, which sums per-module additional-location fees and uses Komplit's bundled extra-outlet rate only when the new branch is a full POS+Stok+HR bundle (partial branches fall through to à la carte rates). Free-tier tenants are hard-blocked from creating a second branch with an inline upgrade CTA.

**Inventory pricing model** — retired the unsold `multi_outlet` flat tier in favour of additive per-location pricing on Toko (+Rp 25k/mo) and Bisnis (+Rp 50k/mo), mirroring POS's shape. New `inventoryTotal(planKey, locationCount)` matches `posTotal` API. Inventory billing page and admin InventoryPaymentSheet pick up the new "Jumlah Lokasi" input. `inter_outlet_transfer` feature flag now rolls up into Bisnis.

**Admin drift indicator** — `getTenantBranchBillingDrift` server fn compares each module's latest paid `billedOutletCount` against the actual count of branches with that module enabled. The tenant detail page renders an amber callout when drift > 0 so admins remember to bump `outletCount` on the next renewal.

**Soft enforcement** — paid tenants who add branches mid-cycle aren't blocked at create time; the drift card surfaces the unbilled extras for admin reconciliation. Self-service checkout for pro-rata branch upgrades is intentionally NOT in this slice.

Out of scope: wholesale "Cabang → Outlet" rename, per-branch revenue dashboards, pro-rated mid-cycle billing. Filed as follow-ups.
