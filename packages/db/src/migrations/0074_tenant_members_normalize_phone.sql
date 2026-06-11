-- Backfill tenant_members.phone to the canonical "62XXXXXXXXXX" E.164
-- form so the WA-login lookup can use a direct equality query instead
-- of an O(N) Go-side scan over every opt-in staff per tenant.
--
-- Logic mirrors apps/api/internal/walogin/phone.go and
-- packages/shared/src/validators/wa-login.ts EXACTLY:
--   1. Strip non-digits.
--   2. If already starts with "62" → keep stripped value.
--   3. Else if starts with "0" → replace leading "0" with "62".
--   4. Else if starts with "8" → prepend "62".
--   5. Else → keep stripped value as-is (foreign / unrecognized).
--   6. If length is outside 10..14 → leave the ORIGINAL row alone
--      (preserves "in-progress" or malformed entries without data loss).
--
-- The wa_login feature simply won't match rows that come out malformed,
-- which is the same behavior the old Go-side scan exhibited — no
-- semantic regression for those edge cases.
--
-- Wrapped in a plpgsql DO block because the conditional length check
-- against the computed candidate is awkward to express as a single
-- SQL CASE. The block is one-shot at migration time; runtime writes go
-- through `coerceStorablePhone` in @vintra/shared instead.
DO $$
DECLARE
  r         RECORD;
  digits    text;
  candidate text;
BEGIN
  FOR r IN
    SELECT id, phone FROM tenant_members WHERE phone IS NOT NULL
  LOOP
    digits := regexp_replace(r.phone, '\D', '', 'g');
    candidate := CASE
      WHEN digits LIKE '62%' THEN digits
      WHEN digits LIKE '0%'  THEN '62' || substring(digits FROM 2)
      WHEN digits LIKE '8%'  THEN '62' || digits
      ELSE digits
    END;
    IF length(candidate) BETWEEN 10 AND 14 THEN
      UPDATE tenant_members SET phone = candidate WHERE id = r.id;
    END IF;
    -- else: leave the original alone (out-of-range or unparseable).
  END LOOP;
END $$;

-- Partial covering index on the hot-path WA-login lookup:
--   "find this tenant's opt-in staff whose phone equals X".
-- The partial predicate keeps it tiny — only opt-in members are
-- indexed, so a tenant with 50 staff but 5 WA-login enabled gets a
-- 5-row index. The replacement GetOptInTenantMemberByPhone query
-- (sqlc) hits this index for an O(1) lookup, replacing the O(N) Go
-- scan over ListOptInTenantMembersByTenant.
CREATE INDEX IF NOT EXISTS "tenant_members_wa_login_phone_idx"
  ON "tenant_members" ("tenant_id", "phone")
  WHERE "wa_login_enabled" = true;
