-- Product variants — Phase 2: record the chosen variant on online order
-- lines. Idempotent.

ALTER TABLE "online_order_items"
  ADD COLUMN IF NOT EXISTS "variant_id" uuid;
ALTER TABLE "online_order_items"
  ADD COLUMN IF NOT EXISTS "variant_label" text;

DO $$ BEGIN
  ALTER TABLE "online_order_items"
    ADD CONSTRAINT "online_order_items_variant_id_fk"
    FOREIGN KEY ("variant_id") REFERENCES "inventory_item_variants"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
