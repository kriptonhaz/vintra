-- Trial state for the Attendance module. Distinct from paid subscription
-- columns so both can coexist (admin starts trial, later converts).
-- `trial_used` is the one-time gate; set true at first trial start and
-- never reset programmatically — a new trial requires platform admin
-- intervention via DB.
ALTER TABLE "attendance_settings"
  ADD COLUMN "trial_started_at" timestamp,
  ADD COLUMN "trial_ends_at" timestamp,
  ADD COLUMN "trial_staff_cap" integer,
  ADD COLUMN "trial_used" boolean DEFAULT false NOT NULL;
