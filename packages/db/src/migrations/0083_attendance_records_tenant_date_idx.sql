-- Composite index for the attendance records list + count queries.
--
-- listAttendanceRecords / countRecords filter by
-- `tenant_id = ? AND date BETWEEN ? AND ?` and order by `date DESC`.
-- Without this index Postgres seq-scans + sorts attendance_records;
-- harmless today but degrades as daily clock-in rows accumulate
-- (100 staff x 2 rows/day ~= 73k rows/year). The (tenant_id, date)
-- order serves both the equality filter and the range + sort.
--
-- Rollback:
--   DROP INDEX "attendance_records_tenant_date_idx";

CREATE INDEX IF NOT EXISTS "attendance_records_tenant_date_idx"
  ON "attendance_records" ("tenant_id", "date");
