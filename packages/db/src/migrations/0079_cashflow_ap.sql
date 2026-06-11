-- Cashflow Phase 4 — Cicilan / accounts payable (JUR-158).
--
-- `ap_payables`: an installment plan the tenant owes (supplier cicilan,
-- equipment, recurring bills). `ap_payments`: the per-installment
-- schedule, generated up front. Marking an installment paid posts an
-- `ap_payment` expense row to cashflow_entries (CHECK already widened
-- in migration 0078).
--
-- Rollback: DROP TABLE "ap_payments", "ap_payables";

CREATE TABLE IF NOT EXISTS "ap_payables" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"              text NOT NULL,
  "supplier_id"       uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "total_amount"      numeric(15, 2) NOT NULL,
  "schedule_kind"     text NOT NULL,
  "installment_count" integer NOT NULL,
  "first_due_date"    date NOT NULL,
  "reminders_muted"   boolean NOT NULL DEFAULT false,
  "note"              text,
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ap_payables_schedule_kind_chk"
    CHECK ("schedule_kind" IN ('one_off', 'monthly'))
);

CREATE INDEX IF NOT EXISTS "ap_payables_tenant_idx"
  ON "ap_payables" ("tenant_id");

CREATE TABLE IF NOT EXISTS "ap_payments" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payable_id"          uuid NOT NULL REFERENCES "ap_payables"("id") ON DELETE CASCADE,
  "installment_index"   integer NOT NULL,
  "amount"              numeric(15, 2) NOT NULL,
  "due_date"            date NOT NULL,
  "paid_at"             timestamp,
  "method"              text,
  "note"                text,
  "recorded_by_user_id" uuid,
  CONSTRAINT "ap_payments_method_chk"
    CHECK ("method" IS NULL OR "method" IN ('cash', 'transfer', 'qris', 'other'))
);

CREATE INDEX IF NOT EXISTS "ap_payments_payable_idx"
  ON "ap_payments" ("payable_id");
