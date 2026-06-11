-- JUR-15: Batch prep for recipe-backed POS items.
--
-- Adds:
--   1. `prep_mode` boolean on inventory_items (default false)
--   2. CHECK: prep_mode=true requires linkedHppProductId set
--   3. New table inventory_item_prep_batches (append-only ledger)
--
-- All idempotent via IF NOT EXISTS guards so re-running on prod (which
-- may have already received the column via a partial deploy) is safe.

-- 1. Add prep_mode to inventory_items
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS prep_mode boolean NOT NULL DEFAULT false;

-- 2. Enforce prep_mode requires a recipe link.
--    DROP-then-add so re-running picks up any future tweaks.
ALTER TABLE inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_prep_mode_requires_recipe_chk;
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_prep_mode_requires_recipe_chk
  CHECK (prep_mode = false OR linked_hpp_product_id IS NOT NULL);

-- 3. Prep batch ledger.
--    qty_prepared / qty_consumed in BASE units (matches inventory math).
--    qty_consumed monotonically increases via FIFO sale-time updates.
CREATE TABLE IF NOT EXISTS inventory_item_prep_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  qty_prepared    numeric(15, 4) NOT NULL,
  qty_consumed    numeric(15, 4) NOT NULL DEFAULT 0,
  prepared_by     uuid NOT NULL,
  prepared_at     timestamp NOT NULL DEFAULT now(),
  notes           text,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT inv_prep_batches_consumed_not_over_chk
    CHECK (qty_consumed <= qty_prepared),
  CONSTRAINT inv_prep_batches_prepared_positive_chk
    CHECK (qty_prepared > 0)
);

-- Partial index — FIFO consume only scans open (not-fully-consumed) rows,
-- so a tenant's year-old history doesn't bloat the working set.
CREATE INDEX IF NOT EXISTS inv_prep_batches_open_item_branch_idx
  ON inventory_item_prep_batches (item_id, branch_id, prepared_at)
  WHERE qty_consumed < qty_prepared;

-- Waste report aggregation — group by item + day across the tenant.
CREATE INDEX IF NOT EXISTS inv_prep_batches_tenant_prepared_at_idx
  ON inventory_item_prep_batches (tenant_id, prepared_at);
