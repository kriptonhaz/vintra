---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 3: prep-batch server functions
(`apps/web/src/server/functions/pos-prep.ts`).

- `recordPrepBatch`: gated by inventory.write + ingredient_consumption
  tier feature. Runs the shared BOM walk with reason='prep_batch',
  inserts an open ledger row in `inventory_item_prep_batches`.
- `getPrepStatus`: returns the current "Siap" sum for a (item, branch)
  pair, computed from open ledger rows only.
- `listPrepBatches`: history feed for inventory detail + waste report.

UI wiring lands in step 5 and 6.
