---
"@vintra/web": patch
---

Fix: the POS sales history (`/pos/sales`) and the cashflow ledger (`/cashflow`) now follow the topbar branch switcher. Neither had any branch filter — sales was a tenant-wide query and the cashflow ledger ignored branches entirely. `listCashflowEntries` gained an optional `branchId` that scopes both the entry list and the income/expense totals to the selected outlet.
