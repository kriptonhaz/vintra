-- Toko Online (storefront) — Phase 1 data model.
--
-- Adds online-catalog curation fields to inventory_items and the
-- storefront tables: settings, shipping zones, an order counter, and
-- the online_orders / online_order_items pair (separate from pos_sales
-- because online orders have a real lifecycle + manual payment recon).
--
-- All idempotent (IF NOT EXISTS) in case applied out-of-band.

-- ── inventory_items: online curation ────────────────────────────────
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "is_online" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "shipping_weight_grams" integer;
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "online_stock_cap" numeric(15, 4);

-- ── storefront_settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "storefront_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE cascade,
  "is_enabled" boolean NOT NULL DEFAULT false,
  "fulfillment_branch_id" uuid REFERENCES "branches"("id") ON DELETE set null,
  "payment_methods" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "delivery_enabled" boolean NOT NULL DEFAULT true,
  "pickup_enabled" boolean NOT NULL DEFAULT true,
  "flat_shipping_fee" numeric(15, 2) NOT NULL DEFAULT '0',
  "wa_confirm_phone" text,
  "admin_notify_instance_id" uuid REFERENCES "wa_instances"("id") ON DELETE set null,
  "apply_tax" boolean NOT NULL DEFAULT true,
  "checkout_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- ── storefront_shipping_zones ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "storefront_shipping_zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "fee" numeric(15, 2) NOT NULL DEFAULT '0',
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "storefront_shipping_zones_tenant_idx"
  ON "storefront_shipping_zones" ("tenant_id", "is_active");

-- ── online_order_counters ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "online_order_counters" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE cascade,
  "year" integer NOT NULL,
  "next_seq" integer NOT NULL DEFAULT 1
);

-- ── online_orders ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "online_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "order_number" text NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE set null,
  "customer_name" text NOT NULL,
  "customer_phone" text NOT NULL,
  "fulfillment_type" text NOT NULL,
  "shipping_recipient" text,
  "shipping_phone" text,
  "shipping_address" text,
  "shipping_zone_id" uuid REFERENCES "storefront_shipping_zones"("id") ON DELETE set null,
  "shipping_zone_label" text,
  "shipping_fee" numeric(15, 2) NOT NULL DEFAULT '0',
  "subtotal" numeric(15, 2) NOT NULL,
  "promo_code_snapshot" text,
  "promo_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "tax_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "tax_lines" jsonb,
  "total" numeric(15, 2) NOT NULL,
  "payment_method" text NOT NULL,
  "payment_proof_key" text,
  "status" text NOT NULL DEFAULT 'pending',
  "courier_name" text,
  "tracking_number" text,
  "loyalty_points_earned" numeric(15, 2),
  "customer_note" text,
  "admin_note" text,
  "confirmed_at" timestamp,
  "confirmed_by" uuid,
  "shipped_at" timestamp,
  "completed_at" timestamp,
  "cancelled_at" timestamp,
  "cancelled_by" uuid,
  "cancel_reason" text,
  "wa_notified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "online_orders_tenant_order_number_unique" UNIQUE ("tenant_id", "order_number"),
  CONSTRAINT "online_orders_status_chk" CHECK ("status" IN ('pending', 'confirmed', 'ready', 'shipped', 'completed', 'cancelled')),
  CONSTRAINT "online_orders_fulfillment_chk" CHECK ("fulfillment_type" IN ('delivery', 'pickup'))
);
CREATE INDEX IF NOT EXISTS "online_orders_tenant_status_idx"
  ON "online_orders" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "online_orders_tenant_phone_idx"
  ON "online_orders" ("tenant_id", "customer_phone");

-- ── online_order_items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "online_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" uuid NOT NULL REFERENCES "online_orders"("id") ON DELETE cascade,
  "item_id" uuid REFERENCES "inventory_items"("id") ON DELETE set null,
  "name_snapshot" text NOT NULL,
  "sku_snapshot" text,
  "qty" numeric(15, 4) NOT NULL,
  "unit_price" numeric(15, 2) NOT NULL,
  "subtotal" numeric(15, 2) NOT NULL,
  "weight_grams_snapshot" integer,
  "auto_promo_id" uuid REFERENCES "tenant_promotions"("id") ON DELETE set null,
  "auto_promo_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "hpp_at_sale" numeric(15, 2),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "online_order_items_order_idx"
  ON "online_order_items" ("order_id");
