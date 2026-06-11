-- JUR-148 — public /contact form.
--
-- Adds the submitter IP column used by the per-IP rate limiter on the
-- public contact form (5 submissions per rolling hour) and as a
-- diagnostic field in the admin inbox so spam patterns are visible.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE IF EXISTS "feedback_threads"
  ADD COLUMN IF NOT EXISTS "submitter_ip" text;

CREATE INDEX IF NOT EXISTS "feedback_threads_submitter_ip_created_idx"
  ON "feedback_threads" ("submitter_ip", "created_at");
