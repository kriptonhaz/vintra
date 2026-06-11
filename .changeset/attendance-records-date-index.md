---
"@vintra/db": patch
---

Add a composite index on `attendance_records (tenant_id, date)`. The records list and count queries filter by tenant + date range and order by date; the index serves both without a sequential scan as daily clock-in rows accumulate.
