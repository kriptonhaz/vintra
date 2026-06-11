-- JUR-15 v2: per-ingredient deduct timing on product_materials.
--
-- 'prep'   = consumed at prep batch creation (or per sale when prep_mode is off)
-- 'finish' = consumed per sale even in prep mode (e.g. gula/susu/sirup)
--
-- Default 'prep' keeps every existing recipe behaving exactly the same.
-- Idempotent so re-running is safe.

ALTER TABLE product_materials
  ADD COLUMN IF NOT EXISTS add_at text NOT NULL DEFAULT 'prep';

ALTER TABLE product_materials
  DROP CONSTRAINT IF EXISTS product_materials_add_at_chk;
ALTER TABLE product_materials
  ADD CONSTRAINT product_materials_add_at_chk
  CHECK (add_at IN ('prep', 'finish'));
