---
"@vintra/web": minor
"@vintra/db": minor
---

Phase 2 — cashflow per-branch. Add a nullable `branch_id` to `cashflow_accounts`, `ar_receivables`, and `ap_payables` (migration `0089`) so a multi-branch tenant can attribute money pots, receivables, and payables to an outlet; `cashflow_entries` already carried `branch_id`. Existing rows stay valid as unassigned/shared.

The cashflow dashboard's branch filter is seeded from the global topbar branch switcher, while keeping its own "Semua cabang" all-branches option.
