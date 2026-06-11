-- JUR-184: Tenant-wide concurrency cap for bookings.
--
-- Nullable so existing tenants keep behavior (no cap; only per-resource
-- "1 booking per slot" rule). Use case: 3 stylists + 2 chairs salon
-- sets this to 2 — calendar allows 3 staff columns but enforces no
-- more than 2 overlapping confirmed/in-progress bookings tenant-wide.

ALTER TABLE "booking_settings"
  ADD COLUMN IF NOT EXISTS "max_concurrent_slots" integer;
