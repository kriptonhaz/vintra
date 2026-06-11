---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

JUR-15 v2: per-ingredient deduct timing on HPP recipes — fixes the
warung kopi pattern.

Before: prep mode deducted ALL BOM ingredients at prep time, so a
50-cup tea prep would phantom-consume 1000g sugar even though the
cashier physically adds sugar per cup.

Now each `product_materials` row carries an `add_at` flag ('prep' or
'finish') set in the HPP recipe editor's new "Tahap" column. Prep
batches only consume add_at='prep' rows; prep-mode sales also deduct
add_at='finish' rows so per-cup additions (gula, susu, sirup) line up
with actual inventory movement.

- New `add_at` column on `product_materials` with CHECK constraint;
  default 'prep' keeps every existing recipe behaving exactly the same.
- HPP recipe editor: "Tahap" column with Prep / Saat dijual dropdown.
- `deductBomIngredients` helper gains a `phase` parameter that filters
  BOM rows by add_at. Default 'all' keeps non-prep-mode sales unchanged.
- `recordPrepBatch` calls with phase='prep'; prep-mode sale path
  additionally calls with phase='finish' alongside the FIFO consume.
