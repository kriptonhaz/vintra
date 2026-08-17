---
"@vintra/db": patch
---

Add `bun run check:drift`, which diffs the Drizzle schema against the live
database column by column.

`drizzle-kit generate` has been broken since June 2026 — the meta snapshot
history collides at 0004/0005 and is frozen at 19 tables while the schema has
127 — so every migration since 0006 has been hand-written and nothing verified
that the SQL matched the schema files. This closes that gap, and runs daily in
the Database watch workflow.

It reads the schema through Drizzle's own `getTableConfig`, not by parsing the
TypeScript, and reports four categories: tables/columns present in one side but
not the other (structural, exits 1) and type differences (advisory, exits 1 only
under `--strict`, since a normalisation gap should not masquerade as drift).

First run is clean: 127 tables and 1377 columns match exactly, types included.
That makes a future migration squash safe from a drift standpoint — the check
JuraganQu lacked when a legacy `materials.supplier` column broke a dump restore.
