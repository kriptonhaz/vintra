---
"@vintra/web": minor
"@vintra/db": minor
---

Add a global branch switcher (Qasir-style) in the topbar. The selected branch lives in a shared `BranchContext`, persists to `localStorage`, and is seeded from the member's accessible branches (main branch first). The switcher is role-adaptive: single-branch tenants see nothing, branch-scoped staff see a static label, and users with multiple branches get a dropdown.

The inventory dashboard now reads the selected branch — its low-stock and stock-value stats reflect that branch instead of an unlabelled tenant-wide aggregate. Adds tenant-level `branch_model` (`independent` / `franchise`) and `situs_mode` (`single` / `per_branch`) settings (migration `0088`) for the franchise vs multi-outlet distinction.
