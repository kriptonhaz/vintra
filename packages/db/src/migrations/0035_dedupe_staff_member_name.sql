-- De-duplicate staff/member name. Until now `staff_profiles.full_name`
-- and `tenant_members.first_name + last_name` could drift — they were
-- written by separate forms. After this migration, `tenant_members` is
-- the single source of truth for "what's this person called"; staff
-- list reads via the join.
--
-- Backfill before drop: any staff_profiles row that has full_name but
-- whose corresponding tenant_members row has no first_name yet gets
-- the name split at the first space. Same for phone + position →
-- jobTitle (kept on staff_profiles for now to avoid a wider churn,
-- but the read path can prefer member values).
--
-- We DO NOT drop staff_profiles.phone or staff_profiles.position in
-- this migration — that's a follow-up once all callers are confirmed
-- to read from tenant_members.

-- 1. Split full_name into first/last where the member side is empty.
UPDATE "tenant_members" tm
SET
  "first_name" = COALESCE(
    NULLIF(split_part(sp."full_name", ' ', 1), ''),
    tm."first_name"
  ),
  "last_name" = COALESCE(
    tm."last_name",
    NULLIF(
      CASE
        WHEN position(' ' IN sp."full_name") > 0
          THEN substring(sp."full_name" FROM position(' ' IN sp."full_name") + 1)
        ELSE NULL
      END,
      ''
    )
  )
FROM "staff_profiles" sp
WHERE sp."tenant_member_id" = tm."id"
  AND sp."full_name" IS NOT NULL
  AND sp."full_name" <> ''
  AND (tm."first_name" IS NULL OR tm."first_name" = '');

-- 2. Backfill phone from staff_profiles when the member side is empty.
UPDATE "tenant_members" tm
SET "phone" = sp."phone"
FROM "staff_profiles" sp
WHERE sp."tenant_member_id" = tm."id"
  AND sp."phone" IS NOT NULL
  AND sp."phone" <> ''
  AND (tm."phone" IS NULL OR tm."phone" = '');

-- 3. Backfill job_title from staff_profiles.position when member side is empty.
UPDATE "tenant_members" tm
SET "job_title" = sp."position"
FROM "staff_profiles" sp
WHERE sp."tenant_member_id" = tm."id"
  AND sp."position" IS NOT NULL
  AND sp."position" <> ''
  AND (tm."job_title" IS NULL OR tm."job_title" = '');

-- 4. Drop the duplicated column.
ALTER TABLE "staff_profiles" DROP COLUMN IF EXISTS "full_name";
