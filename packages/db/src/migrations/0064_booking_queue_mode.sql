-- JUR-167: Queue mode (cuci motor / IGD klinik).
--
-- Two additive columns, both nullable / defaulted so existing slot-mode
-- bookings stay valid:
--
-- 1. bookings.ticket_number — short verbal-calling number assigned at
--    queue ticket creation. NULL for slot-mode bookings (which use
--    start_at as the identifier). Format is "#N" where N is a per-
--    tenant per-day sequence; the server fn computes it from a count
--    query at insert time.
--
-- 2. booking_resources.is_paused — when true, the auto-router skips
--    this resource (e.g. operator on a lunch break). Existing tickets
--    in a paused queue stay in place; new tickets get routed elsewhere.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "ticket_number" text;

ALTER TABLE "booking_resources"
  ADD COLUMN IF NOT EXISTS "is_paused" boolean NOT NULL DEFAULT false;

-- Supports the "fetch this resource's queue" query in the QueueView,
-- ordered by created_at so FIFO arrival order is cheap to render.
CREATE INDEX IF NOT EXISTS "bookings_resource_status_created_idx"
  ON "bookings" ("resource_id", "status", "created_at");
