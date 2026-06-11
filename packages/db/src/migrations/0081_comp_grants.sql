-- Comp / free-access grants (JUR-194).
--
-- A comp activates a module at Rp 0 with a mandatory reason. It is
-- never written to financial_transactions, so it can't inflate
-- revenue. `comp_grants` is the system of record. Only a founder
-- platform admin can approve a comp; a non-founder admin's request
-- waits as 'pending'.
--
-- Rollback:
--   DROP TABLE "comp_grants";
--   ALTER TABLE "platform_admins" DROP COLUMN "is_founder";

ALTER TABLE "platform_admins"
  ADD COLUMN IF NOT EXISTS "is_founder" boolean NOT NULL DEFAULT false;

-- Seed the founder.
UPDATE "platform_admins"
SET "is_founder" = true
WHERE "user_id" = (
  SELECT "id" FROM auth.users WHERE "email" = 'kriptonhaz@gmail.com'
);

CREATE TABLE IF NOT EXISTS "comp_grants" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"             uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "module_key"            text NOT NULL,
  "plan_key"              text NOT NULL,
  "duration_months"       integer NOT NULL,
  "reason"                text NOT NULL,
  "status"                text NOT NULL DEFAULT 'pending',
  "requested_by_user_id"  uuid NOT NULL,
  "reviewed_by_user_id"   uuid,
  "reviewed_at"           timestamp,
  "applied_at"            timestamp,
  "expires_at"            timestamp,
  "created_at"            timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "comp_grants_module_chk"
    CHECK ("module_key" IN ('pos', 'inventory', 'attendance', 'whatsapp')),
  CONSTRAINT "comp_grants_status_chk"
    CHECK ("status" IN ('pending', 'applied', 'rejected'))
);

CREATE INDEX IF NOT EXISTS "comp_grants_tenant_status_idx"
  ON "comp_grants" ("tenant_id", "status");
