-- Named shifts per branch (Pagi, Sore, Malam, etc.)
CREATE TABLE "branch_shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "branch_shifts_branch_name_unique" UNIQUE ("branch_id", "name")
);--> statement-breakpoint

-- Weekly schedule per shift. CHECK enforces same-day (clock-out strictly after
-- clock-in) so v1 can't model cross-midnight shifts.
CREATE TABLE "branch_shift_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "branch_shift_id" uuid NOT NULL REFERENCES "branch_shifts"("id") ON DELETE cascade,
  "day_of_week" smallint NOT NULL,
  "is_work_day" boolean DEFAULT false NOT NULL,
  "clock_in_time" time,
  "clock_out_time" time,
  "late_grace_minutes" integer DEFAULT 10 NOT NULL,
  "early_leave_grace_minutes" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "branch_shift_schedules_shift_day_unique" UNIQUE ("branch_shift_id", "day_of_week"),
  CONSTRAINT "branch_shift_schedules_same_day" CHECK (
    "is_work_day" = false
    OR ("clock_in_time" IS NOT NULL AND "clock_out_time" IS NOT NULL AND "clock_out_time" > "clock_in_time")
  )
);--> statement-breakpoint

-- Attach optional shift assignment to staff. NULL = regular worker (branch default schedule).
ALTER TABLE "staff_profiles"
  ADD COLUMN "branch_shift_id" uuid REFERENCES "branch_shifts"("id") ON DELETE set null;--> statement-breakpoint

-- Snapshot the shift on attendance records so historical reports stay attributable.
ALTER TABLE "attendance_records"
  ADD COLUMN "branch_shift_id" uuid REFERENCES "branch_shifts"("id") ON DELETE set null;
