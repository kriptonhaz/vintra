-- JUR-8: Loyalty points (earn + redeem). Komplit-tier feature.
--
-- Adds:
--   - pos_settings.loyalty_enabled / earn_rate / redeem_rate (config)
--   - pos_sales.loyalty_points_earned / redeemed / redeem_amount (per-sale snapshot)
--   - customer_loyalty_balances (one row per customer; lazy insert)
--   - customer_loyalty_movements (ledger; one row per earn/redeem/adjust/expire)
--
-- Schema cols are nullable on pos_sales so historical sales pre-loyalty
-- don't need backfill. Balances + movements are independent of any
-- single sale so they can be voided + reversed cleanly.

-- Settings
ALTER TABLE "pos_settings"
  ADD COLUMN "loyalty_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "loyalty_earn_rate" numeric(15, 4) NOT NULL DEFAULT 0.001,
  ADD COLUMN "loyalty_redeem_rate" numeric(15, 2) NOT NULL DEFAULT 10;
--> statement-breakpoint

-- Per-sale snapshot
ALTER TABLE "pos_sales"
  ADD COLUMN "loyalty_points_earned" numeric(15, 2),
  ADD COLUMN "loyalty_points_redeemed" numeric(15, 2),
  ADD COLUMN "loyalty_redeem_amount" numeric(15, 2);
--> statement-breakpoint

-- Balances
CREATE TABLE "customer_loyalty_balances" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id"       uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "points_balance"    numeric(15, 2) NOT NULL DEFAULT 0,
  "lifetime_earned"   numeric(15, 2) NOT NULL DEFAULT 0,
  "lifetime_redeemed" numeric(15, 2) NOT NULL DEFAULT 0,
  "updated_at"        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_loyalty_balances_customer_unique" UNIQUE ("customer_id")
);
--> statement-breakpoint

-- Ledger
CREATE TABLE "customer_loyalty_movements" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id"  uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "type"         text NOT NULL,
  "points"       numeric(15, 2) NOT NULL,
  "sale_id"      uuid REFERENCES "pos_sales"("id"),
  "reason"       text,
  "performed_by" uuid,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_loyalty_movements_type_chk"
    CHECK ("type" IN ('earn', 'redeem', 'adjust', 'expire'))
);
--> statement-breakpoint

CREATE INDEX "customer_loyalty_movements_customer_idx"
  ON "customer_loyalty_movements" ("customer_id", "created_at");
--> statement-breakpoint

CREATE INDEX "customer_loyalty_movements_sale_idx"
  ON "customer_loyalty_movements" ("sale_id")
  WHERE "sale_id" IS NOT NULL;
