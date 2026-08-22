---
"@vintra/web": patch
---

Fix every branch-scoped member crashing Inventaris and POS reports.

Eleven hand-written `sql` fragments scoped a query with
`branch_id = ANY(${auth.allowedBranchIds}::uuid[])`. Drizzle binds the JS array
as a single parameter, so Postgres received a bare uuid where an array literal
belonged and threw `malformed array literal`. An owner's `allowedBranchIds` is
null and never reached that branch of the ternary, so the queries worked in all
owner testing and failed for anyone pinned to specific branches — Cafe Camaro's
supervisor could not open Pergerakan Stok, Sesuaikan Stok, Daftar Stok, Bahan
Baku, or any POS report.

This exact bug was found and fixed once before, in the seven Drizzle
query-builder call sites (`inArray()` there). The eleven raw-SQL ones were
missed because `branchScopeWhere` needs a column object and these scope table
aliases (`b.`, `s.`, `s2.`). `branchScopeSql` now covers that case and is
tested, so the correct spelling exists for both shapes and nobody has to
hand-write `= ANY(` again.

No data was ever exposed: the broken query threw rather than returning
unfiltered rows.
