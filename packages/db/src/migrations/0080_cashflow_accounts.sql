-- Cashflow v2 — Akun Kas & Bank (JUR-192).
--
-- Adds a per-tenant account layer: `cashflow_accounts` (cash drawer,
-- bank, e-wallet), `cashflow_transfers` (money moved between a tenant's
-- own accounts — never income/expense), and an `account_id` on every
-- `cashflow_entries` row.
--
-- Every existing tenant gets one auto-seeded default "Kas Utama"
-- account; existing entries back-fill to it, so single-account tenants
-- are unaffected.
--
-- Rollback:
--   ALTER TABLE "cashflow_entries" DROP COLUMN "account_id";
--   DROP TABLE "cashflow_transfers", "cashflow_accounts";

CREATE TABLE IF NOT EXISTS "cashflow_accounts" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"       uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"            text NOT NULL,
  "kind"            text NOT NULL DEFAULT 'cash',
  "opening_balance" numeric(15, 2) NOT NULL DEFAULT '0',
  "is_default"      boolean NOT NULL DEFAULT false,
  "is_active"       boolean NOT NULL DEFAULT true,
  "sort_order"      integer NOT NULL DEFAULT 0,
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "updated_at"      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cashflow_accounts_kind_chk"
    CHECK ("kind" IN ('cash', 'bank', 'ewallet', 'other'))
);

CREATE INDEX IF NOT EXISTS "cashflow_accounts_tenant_idx"
  ON "cashflow_accounts" ("tenant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "cashflow_accounts_default_unique"
  ON "cashflow_accounts" ("tenant_id") WHERE "is_default";

-- One default "Kas Utama" account per existing tenant.
INSERT INTO "cashflow_accounts" ("tenant_id", "name", "kind", "is_default", "is_active")
SELECT "id", 'Kas Utama', 'cash', true, true FROM "tenants"
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "cashflow_transfers" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"          uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "from_account_id"    uuid NOT NULL REFERENCES "cashflow_accounts"("id"),
  "to_account_id"      uuid NOT NULL REFERENCES "cashflow_accounts"("id"),
  "amount"             numeric(15, 2) NOT NULL,
  "date"               date NOT NULL,
  "note"               text,
  "created_by_user_id" uuid NOT NULL,
  "created_at"         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cashflow_transfers_distinct_chk"
    CHECK ("from_account_id" <> "to_account_id")
);

CREATE INDEX IF NOT EXISTS "cashflow_transfers_tenant_date_idx"
  ON "cashflow_transfers" ("tenant_id", "date");

-- account_id on the ledger: add nullable, back-fill to each tenant's
-- default account, then enforce NOT NULL.
ALTER TABLE "cashflow_entries"
  ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "cashflow_accounts"("id");

UPDATE "cashflow_entries" e
SET "account_id" = (
  SELECT a."id" FROM "cashflow_accounts" a
  WHERE a."tenant_id" = e."tenant_id" AND a."is_default"
  LIMIT 1
)
WHERE e."account_id" IS NULL;

ALTER TABLE "cashflow_entries" ALTER COLUMN "account_id" SET NOT NULL;
