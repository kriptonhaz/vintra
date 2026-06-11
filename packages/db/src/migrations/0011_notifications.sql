-- Notifications + Web Push subscriptions + tenant-wide reminder config
-- on attendance_settings. Covers in-app bell-icon notifications, native
-- browser push, and the trigger configuration for clock-in/out reminders.

-- ── notifications ────────────────────────────────────────────────────
-- Recipient-keyed rows. tenant_id nullable so platform-wide announcements
-- are representable. source_key + the partial unique index below give us
-- idempotent inserts via ON CONFLICT DO NOTHING (used by the cron tick).
CREATE TABLE "notifications" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL,
  "tenant_id"   uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "type"        text NOT NULL,
  "title"       text NOT NULL,
  "body"        text NOT NULL,
  "url"         text,
  "data"        jsonb,
  "source_key"  text,
  "read_at"     timestamp,
  "created_at"  timestamp NOT NULL DEFAULT now()
);

-- Hot path: list newest-first per user.
CREATE INDEX "notifications_user_created_idx"
  ON "notifications" ("user_id", "created_at");

-- Hot path: unread badge count. Partial index keeps it tiny.
CREATE INDEX "notifications_user_unread_idx"
  ON "notifications" ("user_id")
  WHERE "read_at" IS NULL;

-- Idempotency target. Only rows with a source_key participate.
CREATE UNIQUE INDEX "notifications_dedup_idx"
  ON "notifications" ("user_id", "type", "source_key")
  WHERE "source_key" IS NOT NULL;

-- ── push_subscriptions ───────────────────────────────────────────────
-- One row per (user, browser). A user may have several (laptop + phone).
-- 410 GONE responses from web-push trigger DELETE of the matching row.
CREATE TABLE "push_subscriptions" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL,
  "endpoint"      text NOT NULL UNIQUE,
  "p256dh"        text NOT NULL,
  "auth"          text NOT NULL,
  "user_agent"    text,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "last_seen_at"  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "push_subscriptions_user_idx"
  ON "push_subscriptions" ("user_id");

-- ── attendance_settings: reminder config ─────────────────────────────
-- Tenant-wide. direction = 'before' | 'after'. Same minutes value either
-- way; sign comes from direction. Defaults are off + 10 min before.
ALTER TABLE "attendance_settings"
  ADD COLUMN "clockin_reminder_enabled"    boolean NOT NULL DEFAULT false,
  ADD COLUMN "clockin_reminder_minutes"    integer NOT NULL DEFAULT 10,
  ADD COLUMN "clockin_reminder_direction"  text    NOT NULL DEFAULT 'before',
  ADD COLUMN "clockout_reminder_enabled"   boolean NOT NULL DEFAULT false,
  ADD COLUMN "clockout_reminder_minutes"   integer NOT NULL DEFAULT 10,
  ADD COLUMN "clockout_reminder_direction" text    NOT NULL DEFAULT 'before',
  ADD CONSTRAINT "clockin_reminder_direction_chk"
    CHECK ("clockin_reminder_direction"  IN ('before', 'after')),
  ADD CONSTRAINT "clockout_reminder_direction_chk"
    CHECK ("clockout_reminder_direction" IN ('before', 'after'));
