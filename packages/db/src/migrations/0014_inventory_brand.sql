-- Adds an optional `brand` column to inventory_items, mirroring the
-- equivalent column on `materials` so HPP-linked items can fall back
-- to the master brand when their own value is null.
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "brand" text;
