---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 2: extract BOM-deduct helper from pos.ts into a shared
module (`apps/web/src/server/lib/bom-deduct.ts`). Refactor only — no
behavior change. The helper is now parameterized over `reason`,
`referenceType`, `referenceId`, and `notesPrefix` so JUR-15's prep-batch
flow can reuse the exact same BOM walk + stock movement insert that POS
sales use today.
