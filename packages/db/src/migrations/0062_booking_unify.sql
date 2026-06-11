-- JUR-182: Booking refactor — unify schema with members + inventory + branches.
--
-- Drops three duplicate data structures from JUR-166:
--   - booking_services (replaced by inventory_items + new is_bookable flag)
--   - booking_settings.working_hours (replaced by branches.business_hours,
--     which is already consumed by the WhatsApp RAG operating_hours retriever)
--   - implicit "staff resources live separately from members" model
--     (booking_resources now optionally links to a tenant_members row)
--
-- Safe to apply: no real prod data exists yet for booking_* tables.

-- 1. Drop the duplicate tables / columns
DROP TABLE IF EXISTS "booking_services" CASCADE;
ALTER TABLE IF EXISTS "booking_settings" DROP COLUMN IF EXISTS "working_hours";

-- 2. Add the right shape — booking columns on inventory_items
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "is_bookable" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "booking_color" text;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "booking_duration_min" integer;

-- 3. Resource → member link
ALTER TABLE "booking_resources"
  ADD COLUMN IF NOT EXISTS "member_id" uuid REFERENCES "tenant_members"("id") ON DELETE SET NULL;

-- 4. Booking → branch link + index
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "bookings_branch_start_idx"
  ON "bookings" ("branch_id", "start_at");

-- 5. Seed a 'jasa' (service) unit so the booking setup wizard can create
--    inventory_items rows for services without forcing tenants to pick
--    an awkward unit like 'pcs'. Idempotent — ON CONFLICT does nothing.
INSERT INTO "master_hpp_units" ("value", "label", "sort_order")
VALUES ('jasa', 'Jasa / Layanan', 99)
ON CONFLICT ("value") DO NOTHING;

-- 6. Clean up seeded test data from JUR-166's setup wizard (no real
--    bookings exist yet). Order matters: bookings → resources → settings
--    because of FK references.
DELETE FROM "bookings";
DELETE FROM "booking_resources";
DELETE FROM "booking_settings";
