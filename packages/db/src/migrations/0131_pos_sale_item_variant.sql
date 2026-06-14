-- Product variants — Phase 3 (POS): record the chosen variant on POS
-- sale lines so the cashier can sell variants and voids restock the
-- right combo. Idempotent.

ALTER TABLE "pos_sale_items"
  ADD COLUMN IF NOT EXISTS "variant_id" uuid;
ALTER TABLE "pos_sale_items"
  ADD COLUMN IF NOT EXISTS "variant_label" text;

DO $$ BEGIN
  ALTER TABLE "pos_sale_items"
    ADD CONSTRAINT "pos_sale_items_variant_id_fk"
    FOREIGN KEY ("variant_id") REFERENCES "inventory_item_variants"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
