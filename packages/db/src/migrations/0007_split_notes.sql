ALTER TABLE "attendance_records" ADD COLUMN "clock_in_notes" text;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "clock_out_notes" text;--> statement-breakpoint
-- Backfill: split any existing merged notes on the "— clock-out —" divider.
-- Rows without a divider: the whole string is treated as clock-in notes.
UPDATE "attendance_records"
SET
  "clock_in_notes" = CASE
    WHEN position(E'\n— clock-out —\n' in "notes") > 0
      THEN substring("notes" from 1 for position(E'\n— clock-out —\n' in "notes") - 1)
    ELSE "notes"
  END,
  "clock_out_notes" = CASE
    WHEN position(E'\n— clock-out —\n' in "notes") > 0
      THEN substring("notes" from position(E'\n— clock-out —\n' in "notes") + length(E'\n— clock-out —\n'))
    ELSE NULL
  END
WHERE "notes" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" DROP COLUMN "notes";
