-- Storefront product gallery — additional photos per item, shown only on
-- the public product detail page. The item's own `photo_key` stays the
-- cover/thumbnail used by POS, the inventory list, and the catalog grid.
-- Item-level (shared across variants). Idempotent in case applied
-- out-of-band.

CREATE TABLE IF NOT EXISTS "inventory_item_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE cascade,
  "photo_key" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "inventory_item_photos_item_idx"
  ON "inventory_item_photos" ("item_id");
