-- Product variants (Phase 1) — Size × Color style, per-variant price +
-- per-branch stock. Online-first; POS variant-selling is a later phase.
-- All idempotent (IF NOT EXISTS) in case applied out-of-band.

-- ── inventory_items: variant flags ──────────────────────────────────
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "has_variants" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "variant_config" jsonb;

-- ── inventory_item_variants (combinations) ──────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_item_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE cascade,
  "value1" text NOT NULL,
  "value2" text NOT NULL DEFAULT '',
  "sku" text,
  "price" numeric(15, 2) NOT NULL DEFAULT '0',
  "photo_key" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_item_variants_combo_unique" UNIQUE ("item_id", "value1", "value2")
);
CREATE INDEX IF NOT EXISTS "inventory_item_variants_item_idx"
  ON "inventory_item_variants" ("item_id");

-- ── inventory_movements: optional variant target ────────────────────
ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "variant_id" uuid;
DO $$ BEGIN
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_variant_id_fk"
    FOREIGN KEY ("variant_id") REFERENCES "inventory_item_variants"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── inventory_item_variant_stock (per variant, per branch) ──────────
CREATE TABLE IF NOT EXISTS "inventory_item_variant_stock" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "variant_id" uuid NOT NULL REFERENCES "inventory_item_variants"("id") ON DELETE cascade,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "quantity" numeric(15, 4) NOT NULL DEFAULT '0',
  "last_movement_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_item_variant_stock_unique" UNIQUE ("variant_id", "branch_id")
);
