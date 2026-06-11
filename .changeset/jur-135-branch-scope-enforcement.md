---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-135 PR 2 — enforce per-member branch scoping across POS + Inventory:

PR 1 wired `tenant_member_branches` storage + the owner UI. This PR turns on the gating: a member pinned to "Cabang BSD" now sees only Cabang BSD's sales, stock, movements, and reports. Cross-branch URL hits return "tidak ditemukan" rather than leaking the row's existence.

**New helpers** (`apps/web/src/server/lib/branch-scope.ts`):
- `assertBranchAllowed(auth, branchId)` — throws for restricted members; no-op for owners + pre-JUR-135 unrestricted callers (where `allowedBranchIds === null`).
- `filterBranchesByAccess(auth, branches)` — returns the input unchanged when unrestricted.
- `branchScopeWhere(auth, column)` — Drizzle SQL clause that spreads into `and(...)` cleanly; returns `undefined` when unrestricted so callers don't add tautologies. Empty allowed-list yields `IN (NULL)` as a defensive no-leak fallback.

**POS** (`apps/web/src/server/functions/pos.ts`):
- `getPOSCashierMasters` filters `branches[]` by member access AND now exposes `branchAccessRestricted: boolean` so the cashier UI distinguishes "tenant has 0 branches" from "you're not pinned to any branch".
- `getPOSOverview` raw SQL gains a branch-array filter (today's sales count + revenue + top items).
- `listPOSProducts` asserts before joining stock balances.
- `createSale` asserts after the tier check (tier error wins if both apply).
- `getSale` + `voidSale` fold the scope into WHERE for 404-via-scope behavior.
- `listSales` — explicit branchId asserts; otherwise scopes the where clause.
- `getPOSReport` + `getDailyZReport` — same pattern (and the inner subqueries that join through `s2` get a parallel `branchClauseS2`).
- `getPOSBranchHours` + `updateBranchReceipt` — assert before reading/writing per-branch state.

**Inventory** (`apps/web/src/server/functions/inventory.ts` + `inventory-po.ts`):
- `listInventoryItems` balance-sum gains the branch filter (cashiers no longer see "100 units across all branches" they can't touch).
- `recordMovement` + `deleteMovement` — write gating + 404-via-scope.
- `listInventoryMovements` — explicit filter asserts; otherwise scoped.
- `listInventoryBranches` — filter the returned set.
- `createPurchaseOrder`, `listPurchaseOrders`, `getPurchaseOrder`, `sendPurchaseOrder`, `cancelPurchaseOrder`, `receivePurchaseOrder` — all gated.

**Cashier UI** (`apps/web/src/routes/_authed/pos/cashier.tsx`):
- New empty-state branch when `branchAccessRestricted && branches.length === 0`: "Anda belum punya akses ke cabang manapun. Hubungi pemilik..." (vs. the existing "Belum ada cabang. Tambahkan dari Data Master.").

**Out of scope**:
- Attendance is already scoped via `staff_profiles.branchId` (per JUR-113 research) — no changes needed.
- Per-permission branch scoping (e.g. "supervisor can read but not transact on branch X") still requires the RBAC overhaul; this PR is access-or-no-access only.
