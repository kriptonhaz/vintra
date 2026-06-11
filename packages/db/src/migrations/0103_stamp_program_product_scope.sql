-- JUR-XXX (product-scope stamps): let a stamp program target a single
-- inventory item rather than a whole category. Category scope still
-- works — `category_id` becomes nullable and gets a CHECK enforcing
-- exactly one of (category_id, product_id) is set. Re-builds the
-- active-uniqueness indexes so each scope is independently unique.

-- Drop the old partial unique index so we can replace it with a
-- variant scoped to category-only rows.
DROP INDEX IF EXISTS loyalty_stamp_programs_active_category_unique;

-- category_id was NOT NULL; relax it so product-scoped rows can have
-- it null. The CHECK below guarantees at least one scope is always set.
ALTER TABLE loyalty_stamp_programs
  ALTER COLUMN category_id DROP NOT NULL;

-- New nullable product scope. Same on-delete behaviour as category_id
-- (cascade) so deleting an item kills any program that pinned to it.
ALTER TABLE loyalty_stamp_programs
  ADD COLUMN IF NOT EXISTS product_id uuid
    REFERENCES inventory_items(id) ON DELETE CASCADE;

-- Exactly one of (category_id, product_id) must be set. Idempotent
-- via DO block — re-running the migration won't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loyalty_stamp_programs_scope_xor_chk'
  ) THEN
    ALTER TABLE loyalty_stamp_programs
      ADD CONSTRAINT loyalty_stamp_programs_scope_xor_chk
      CHECK (
        (category_id IS NOT NULL)::int + (product_id IS NOT NULL)::int = 1
      );
  END IF;
END $$;

-- Re-build the active-uniqueness indexes, one per scope. Inactive
-- (archived) rows are still allowed to coexist with a fresh active one.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_stamp_programs_active_category_unique
  ON loyalty_stamp_programs (tenant_id, category_id)
  WHERE is_active AND category_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_stamp_programs_active_product_unique
  ON loyalty_stamp_programs (tenant_id, product_id)
  WHERE is_active AND product_id IS NOT NULL;
