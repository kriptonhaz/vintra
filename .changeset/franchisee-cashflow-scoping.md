---
"@vintra/web": patch
---

Franchisee branch-scoped cashflow. A branch-restricted member (a Pemilik Outlet / `outlet_owner`) is now hard-scoped to their own branch's cashflow: the ledger, dashboard, CSV export, and P&L PDF only ever return entries of a branch they run — regardless of any `branchId` passed — and creating / editing / deleting an entry rejects one outside that scope (a scoped caller must also attribute new entries to their branch). Owners and admins are unaffected.
