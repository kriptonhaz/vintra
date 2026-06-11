-- Separate Pengumuman from the notification bell (Phase 2).
--
-- Phase 1 fanned each announcement out into the notifications table so it
-- rode the bell + unread system. Pengumuman is now its own channel
-- (owner→staff broadcasts, distinct from system notifications), so it
-- gets its own per-user read tracking and stops touching notifications.

-- 1. Per-user read state for announcements.
CREATE TABLE "announcement_reads" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "user_id"         uuid NOT NULL,
  "read_at"         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "announcement_reads_uniq" UNIQUE ("announcement_id", "user_id")
);

CREATE INDEX "announcement_reads_user_idx"
  ON "announcement_reads" ("user_id");

-- 2. Bell cleanup: remove the Phase-1 announcement rows that were fanned
--    into notifications. Going forward createAnnouncement no longer writes
--    notifications, so the bell is system-only again.
DELETE FROM "notifications" WHERE "type" = 'announcement';
