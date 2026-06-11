---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

Inventory module Phase 1 (Free + Toko tiers).

**Free tier** (every tenant, no payment): up to 25 active SKUs, 1 branch, basic stock-in / stock-out / adjustment movements with last-30-day history, automatic HPP material price sync on stock-in. Items optionally link to existing HPP materials.

**Toko tier** (Rp 49.000/month, Rp 39.000/month annual): 200 SKUs, 2 branches, unlimited movement history, supplier purchase orders with partial-receive, daily low-stock notification digest at 07:00 WIB, multi-unit conversions (kg/pcs/dus/lusin), bidirectional HPP cost sync.

**Bisnis** and **Multi-Outlet** tiers ship as "Coming Soon" cards in the billing page; pricing is locked in via `INVENTORY_PLANS` so the upgrade path is visible. Variants / batch tracking / barcode / inter-outlet transfer are deferred to Phase 2 + Phase 3.

Reuses existing infrastructure: `branches` table (multi-module), `suppliers` master, `tenant_categories`, `master_hpp_units`, `notifications` chokepoint, scheduler with new daily 07:00 WIB tick. Mirrors the attendance subscription pattern (settings table, trial-once-per-tenant, paid+trial orthogonality, financial_transactions ledger entries with `module_key='inventory'`, audit log).

Admin tooling: trial start/end controls on the tenant detail page (paid activation deferred to follow-up — admins can issue paid activations via SQL until the inventory PaymentSheet ships).
