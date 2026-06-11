-- Cashflow Phase 3 — Bon Pelanggan / accounts receivable (JUR-157).
--
-- `ar_receivables`: money a customer owes the tenant. `ar_payments`:
-- individual (possibly partial) collections against a receivable.
-- Recording a payment also writes a cashflow_entries income row with
-- source 'ar_payment' — so the source CHECK is widened here to allow
-- 'ar_payment' and 'ap_payment' (the latter reserved for Phase 4).
--
-- Rollback:
--   DROP TABLE "ar_payments", "ar_receivables";
--   ALTER TABLE "cashflow_entries" DROP CONSTRAINT "cashflow_entries_source_chk";
--   ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk"
--     CHECK ("source" IN ('manual', 'pos_sale', 'bank_import'));

ALTER TABLE "cashflow_entries" DROP CONSTRAINT IF EXISTS "cashflow_entries_source_chk";
ALTER TABLE "cashflow_entries" ADD CONSTRAINT "cashflow_entries_source_chk"
  CHECK ("source" IN ('manual', 'pos_sale', 'bank_import', 'ar_payment', 'ap_payment'));

CREATE TABLE IF NOT EXISTS "ar_receivables" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "sale_id"     uuid REFERENCES "pos_sales"("id") ON DELETE SET NULL,
  "amount"      numeric(15, 2) NOT NULL,
  "paid_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "status"      text NOT NULL DEFAULT 'outstanding',
  "due_date"    date,
  "note"        text,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "paid_at"     timestamp,
  "updated_at"  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ar_receivables_status_chk"
    CHECK ("status" IN ('outstanding', 'partial', 'paid', 'written_off'))
);

CREATE INDEX IF NOT EXISTS "ar_receivables_tenant_status_idx"
  ON "ar_receivables" ("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "ar_payments" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receivable_id"       uuid NOT NULL REFERENCES "ar_receivables"("id") ON DELETE CASCADE,
  "amount"              numeric(15, 2) NOT NULL,
  "method"              text NOT NULL,
  "note"                text,
  "recorded_by_user_id" uuid NOT NULL,
  "paid_at"             timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ar_payments_method_chk"
    CHECK ("method" IN ('cash', 'transfer', 'qris', 'other'))
);

CREATE INDEX IF NOT EXISTS "ar_payments_receivable_idx"
  ON "ar_payments" ("receivable_id");
