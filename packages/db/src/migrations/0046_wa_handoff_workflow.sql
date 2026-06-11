-- JUR-74: human handoff workflow.
-- Per-contact handoff state — "needs_human" flips on when AI decides
-- it can't help and pauses AI until admin re-enables manually OR
-- handoff_auto_resume_hours elapses on the next inbound.
ALTER TABLE "wa_contacts"
  ADD COLUMN "needs_human" boolean NOT NULL DEFAULT false,
  ADD COLUMN "handoff_at" timestamp,
  ADD COLUMN "handoff_reason" text,
  ADD COLUMN "handoff_summary" text;
--> statement-breakpoint

-- Partial index — fast lookup of contacts currently in handoff for the
-- chat sidebar badge query. Only ~1% of contacts are flagged at any
-- time, so the partial index keeps it tiny.
CREATE INDEX "wa_contacts_needs_human_idx"
  ON "wa_contacts" ("instance_id", "needs_human")
  WHERE "needs_human" = true;
--> statement-breakpoint

-- Per-instance handoff config.
ALTER TABLE "wa_instances"
  ADD COLUMN "admin_phone" text,
  ADD COLUMN "handoff_auto_resume_hours" integer NOT NULL DEFAULT 24;
--> statement-breakpoint

COMMENT ON COLUMN "wa_instances"."admin_phone" IS
  'WhatsApp number (E.164, no leading +) the AI sends handoff alerts to. Must differ from the instance''s own paired phone_number — whatsmeow rejects self-sends.';
--> statement-breakpoint

COMMENT ON COLUMN "wa_instances"."handoff_auto_resume_hours" IS
  'After this many hours of admin inactivity, AI auto-resumes when the customer sends a new message. 0 = never auto-resume (manual only). Range 0-168.';
