-- Bulk stamp programs: a program can now scope to N qualifying
-- products (not just one) AND grant a multi-item reward bundle on
-- redemption. Existing category-scope + single-product-scope rows
-- keep working unchanged.

-- Drop the old XOR CHECK — it blocks scope='product_set' rows where
-- both category_id and product_id are NULL (the join table holds the
-- items instead).
ALTER TABLE loyalty_stamp_programs
  DROP CONSTRAINT IF EXISTS loyalty_stamp_programs_scope_xor_chk;

-- Scope discriminator. Backfill from existing data so old rows stay
-- valid: category-scoped rows → 'category', product-scoped rows →
-- 'product'. New 'product_set' rows arrive via the editor.
ALTER TABLE loyalty_stamp_programs
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'category';

UPDATE loyalty_stamp_programs
SET scope = 'product'
WHERE product_id IS NOT NULL AND scope = 'category';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loyalty_stamp_programs_scope_kind_chk'
  ) THEN
    ALTER TABLE loyalty_stamp_programs
      ADD CONSTRAINT loyalty_stamp_programs_scope_kind_chk
      CHECK (scope IN ('category', 'product', 'product_set'));
  END IF;
END $$;

-- Reward mode discriminator. Existing rows default to 'single' (they
-- already use reward_item_id). 'bundle' rows store N items in the
-- rewards join table and leave reward_item_id null.
ALTER TABLE loyalty_stamp_programs
  ADD COLUMN IF NOT EXISTS reward_mode text NOT NULL DEFAULT 'single';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loyalty_stamp_programs_reward_mode_chk'
  ) THEN
    ALTER TABLE loyalty_stamp_programs
      ADD CONSTRAINT loyalty_stamp_programs_reward_mode_chk
      CHECK (reward_mode IN ('single', 'bundle'));
  END IF;
END $$;

-- Reward item is now nullable so 'bundle' rows don't need a stand-in.
ALTER TABLE loyalty_stamp_programs
  ALTER COLUMN reward_item_id DROP NOT NULL;

-- Qualifying items for scope = 'product_set'. Each row = one item
-- that earns a stamp when sold. Unique per (program, item) so the
-- editor can't accidentally double-list the same product.
CREATE TABLE IF NOT EXISTS loyalty_stamp_program_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES loyalty_stamp_programs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_stamp_program_items_program_item_unique
    UNIQUE (program_id, item_id)
);

CREATE INDEX IF NOT EXISTS loyalty_stamp_program_items_program_idx
  ON loyalty_stamp_program_items (program_id);
CREATE INDEX IF NOT EXISTS loyalty_stamp_program_items_item_idx
  ON loyalty_stamp_program_items (item_id);

-- Bundle rewards for reward_mode = 'bundle'. One row per item in the
-- bundle, with a positive quantity. sort_order lets the editor
-- preserve display ordering on the cashier + receipt.
CREATE TABLE IF NOT EXISTS loyalty_stamp_program_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES loyalty_stamp_programs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_stamp_program_rewards_quantity_positive_chk
    CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS loyalty_stamp_program_rewards_program_idx
  ON loyalty_stamp_program_rewards (program_id);
