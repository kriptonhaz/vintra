---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Two role-tuning changes around Kasir, building on the prior commit that gave Kasir `pos.read` for `/pos/sales` history:

1. **New `pos.report.view` permission** splits the gate on `/pos/reports` (Laporan + Prep Waste) away from the overloaded `pos.read`. Granted to Owner / Admin / Pemilik Outlet / Supervisor; intentionally not granted to Kasir or Staff. Wired as the gate on the sidebar entry (`constants.ts`), the route `beforeLoad`, `getPOSReport`, and `getPrepWasteReport`. `pos.report.profit` remains the inner sub-gate for HPP / Untung kotor / Margin cards. Net effect: Kasir keeps history visibility, loses Laporan visibility.

2. **`canVoidSale` lowered from `pos.manage` to `pos.transact`.** Cashiers — the role most likely to spot a payment-method mistake mid-shift — can now cancel same-day sales without bouncing the customer back to the owner. The server-side same-day rule in `voidSale` is the real abuse guardrail (past-day refunds still require admin intervention), and an explicit `pos.transact` check was added to `voidSale` as defence in depth.

Prod state already updated: `pos.report.view` permission row inserted, role mappings added for Owner / Admin / Pemilik Outlet / Supervisor (idempotent SQL because the `seed:rbac` script still hits the unrelated `ON CONFLICT` constraint issue).
