-- Storefront product reviews — buyer rating (1–5) + optional comment,
-- gated to completed orders and verified by order number + phone on the
-- public submit path. One review per (order, item). Auto-published;
-- admins can hide via is_hidden. Idempotent in case applied out-of-band.

CREATE TABLE IF NOT EXISTS "online_product_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE cascade,
  "order_id" uuid NOT NULL REFERENCES "online_orders"("id") ON DELETE cascade,
  "customer_name" text NOT NULL,
  "customer_phone" text NOT NULL,
  "rating" integer NOT NULL,
  "comment" text,
  "is_hidden" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "online_product_reviews_order_item_unique" UNIQUE ("order_id", "item_id"),
  CONSTRAINT "online_product_reviews_rating_chk" CHECK ("rating" >= 1 AND "rating" <= 5)
);
CREATE INDEX IF NOT EXISTS "online_product_reviews_item_idx"
  ON "online_product_reviews" ("item_id");
