---
"@vintra/db": minor
---

Franchise / Independent branch model — Phase A foundation. The branch model is per-branch (a tenant can mix franchise and independent outlets), so `branch_model` moves from `tenants` onto `branches` (migration `0095`); `tenants.situs_mode` stays. Adds `inventory_items.franchise_price` — the price HQ charges a franchise branch via the requisition.

Adds the `outlet_owner` ("Pemilik Outlet") RBAC role — a franchisee with full operational control of their own branch (POS, attendance, cashflow, members, stock requisitions) but read-only access to the HQ-owned catalog and no tenant settings.
