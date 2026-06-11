-- Per-(staff, branch, day) attendance records. Supervisors assigned
-- to multiple outlets clock in/out independently at each branch they
-- visit; the previous (staff_profile_id, date) unique constraint
-- forced one record per day per staff regardless of where they were.
--
-- branch_id is nullable (set when a branch is later deleted) and
-- Postgres treats NULL as distinct in unique constraints, so legacy
-- rows whose branch was deleted continue to satisfy the new
-- constraint. No data backfill needed — every existing row has at
-- most one entry per (staff, date) which trivially satisfies the
-- (staff, branch, date) form.
--
-- Idempotent because the new constraint may already exist (this
-- migration was applied out-of-band against the prod DB before the
-- drizzle migrator caught up).

ALTER TABLE "attendance_records"
  DROP CONSTRAINT IF EXISTS "attendance_records_staff_date_unique";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendance_records_staff_branch_date_unique'
      AND conrelid = 'public.attendance_records'::regclass
  ) THEN
    ALTER TABLE "attendance_records"
      ADD CONSTRAINT "attendance_records_staff_branch_date_unique"
      UNIQUE ("staff_profile_id", "branch_id", "date");
  END IF;
END $$;
