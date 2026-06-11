---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 4: branch the POS sale path on `inventoryItems.prepMode`.

When a recipe-backed line has `prep_mode=true`, the sale skips BOM
ingredient deduction (which already happened at prep time) and instead
FIFO-consumes open ledger rows in `inventory_item_prep_batches` under
`FOR UPDATE`. Insufficient prep stock throws and rolls back the whole
sale — matches the "hard block at Siap=0" UX decision.

Non-prep recipe-backed sales are unchanged (same BOM walk via the
helper extracted in step 2). Free-tier behavior unchanged (no
ingredient deduction either way).
