-- JUR-149 — feedback support notifications.
--
-- Creates the feedback tables for environments that have not applied
-- the Phase 1 schema yet, and adds the read/email tracking columns
-- needed by Phase 4's in-app + email fallback notification flow.

CREATE TABLE IF NOT EXISTS "feedback_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "source" text DEFAULT 'in_app' NOT NULL,
  "subject" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "public_email" text,
  "public_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_message_at" timestamp DEFAULT now() NOT NULL,
  "tenant_last_viewed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "feedback_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "feedback_threads"("id") ON DELETE CASCADE,
  "sender_type" text NOT NULL,
  "sender_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "email_sent_at" timestamp
);

ALTER TABLE IF EXISTS "feedback_threads"
  ADD COLUMN IF NOT EXISTS "tenant_last_viewed_at" timestamp;

ALTER TABLE IF EXISTS "feedback_messages"
  ADD COLUMN IF NOT EXISTS "email_sent_at" timestamp;

CREATE INDEX IF NOT EXISTS "feedback_threads_tenant_status_idx"
  ON "feedback_threads" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "feedback_threads_source_status_last_idx"
  ON "feedback_threads" ("source", "status", "last_message_at");

CREATE INDEX IF NOT EXISTS "feedback_messages_thread_idx"
  ON "feedback_messages" ("thread_id", "created_at");
