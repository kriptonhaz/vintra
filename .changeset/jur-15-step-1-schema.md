---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-15 step 1: schema + migration for batch-prep mode on recipe-backed
POS items.

- New `prep_mode` boolean on `inventory_items` (default false).
- CHECK constraint enforces `prep_mode=true` requires a recipe link.
- New table `inventory_item_prep_batches` with `qty_prepared` /
  `qty_consumed` columns for FIFO consume + an open-rows partial index
  so consume scans stay small as history grows.

No behavior change yet — server fns and UI wire-up land in follow-up commits.
