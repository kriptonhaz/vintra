-- Loyalty stamp / punch-card programs (JUR-195).
--
-- A stamp program counts qualifying purchases (not Rupiah) and is
-- scoped to one product category, so e.g. a motor-wash card and a
-- car-wash card accumulate independently for the same customer.
-- This sits alongside the points system (customer_loyalty_*),
-- which is unchanged.
--
-- Rollback:
--   DROP TABLE "customer_stamp_movements";
--   DROP TABLE "customer_stamp_cards";
--   DROP TABLE "loyalty_stamp_programs";

CREATE TABLE IF NOT EXISTS "loyalty_stamp_programs" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"        uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"             text NOT NULL,
  "category_id"      uuid NOT NULL REFERENCES "tenant_categories"("id") ON DELETE CASCADE,
  "stamps_required"  integer NOT NULL,
  "reward_item_id"   uuid NOT NULL REFERENCES "inventory_items"("id"),
  "is_active"        boolean NOT NULL DEFAULT true,
  "created_at"       timestamp NOT NULL DEFAULT now(),
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "loyalty_stamp_programs_stamps_positive_chk"
    CHECK ("stamps_required" > 0)
);

CREATE INDEX IF NOT EXISTS "loyalty_stamp_programs_tenant_idx"
  ON "loyalty_stamp_programs" ("tenant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_stamp_programs_active_category_unique"
  ON "loyalty_stamp_programs" ("tenant_id", "category_id")
  WHERE "is_active";

CREATE TABLE IF NOT EXISTS "customer_stamp_cards" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id"       uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "program_id"        uuid NOT NULL REFERENCES "loyalty_stamp_programs"("id") ON DELETE CASCADE,
  "current_stamps"    integer NOT NULL DEFAULT 0,
  "lifetime_stamps"   integer NOT NULL DEFAULT 0,
  "lifetime_rewards"  integer NOT NULL DEFAULT 0,
  "updated_at"        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_stamp_cards_customer_program_unique"
    UNIQUE ("customer_id", "program_id")
);

CREATE TABLE IF NOT EXISTS "customer_stamp_movements" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"     uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "card_id"       uuid NOT NULL REFERENCES "customer_stamp_cards"("id") ON DELETE CASCADE,
  "type"          text NOT NULL,
  "stamps"        integer NOT NULL,
  "sale_id"       uuid REFERENCES "pos_sales"("id"),
  "reason"        text,
  "performed_by"  uuid,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "customer_stamp_movements_type_chk"
    CHECK ("type" IN ('earn', 'redeem', 'adjust'))
);

CREATE INDEX IF NOT EXISTS "customer_stamp_movements_card_idx"
  ON "customer_stamp_movements" ("card_id", "created_at");
