-- Cashflow Monitoring Phase 1 (JUR-155) — schema + manual income/expense ledger.
--
-- `cashflow_categories`: system rows (tenant_id NULL, is_system true) are
-- shared by every tenant; tenant-custom rows are tenant-scoped. Two partial
-- unique indexes keep system rows globally unique per (kind, name) and
-- tenant-custom rows unique per (tenant, kind, name).
--
-- `cashflow_entries`: the manual ledger. `source` defaults to 'manual';
-- 'pos_sale' (Phase 2) and 'bank_import' (post-v1) are reserved in the
-- CHECK constraint so neither needs a follow-up migration.
--
-- Rollback: DROP TABLE "cashflow_entries", "cashflow_categories";

CREATE TABLE IF NOT EXISTS "cashflow_categories" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"  uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "kind"       text NOT NULL,
  "is_system"  boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cashflow_categories_kind_chk" CHECK ("kind" IN ('income', 'expense'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "cashflow_categories_system_unique"
  ON "cashflow_categories" ("kind", "name") WHERE "is_system";

CREATE UNIQUE INDEX IF NOT EXISTS "cashflow_categories_tenant_unique"
  ON "cashflow_categories" ("tenant_id", "kind", "name") WHERE "tenant_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "cashflow_entries" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"          uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "branch_id"          uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "type"               text NOT NULL,
  "category_id"        uuid NOT NULL REFERENCES "cashflow_categories"("id"),
  "amount"             numeric(15, 2) NOT NULL,
  "date"               date NOT NULL,
  "source"             text NOT NULL DEFAULT 'manual',
  "source_ref"         text,
  "note"               text,
  "created_by_user_id" uuid NOT NULL,
  "created_at"         timestamp NOT NULL DEFAULT now(),
  "updated_at"         timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cashflow_entries_type_chk" CHECK ("type" IN ('income', 'expense')),
  CONSTRAINT "cashflow_entries_source_chk" CHECK ("source" IN ('manual', 'pos_sale', 'bank_import'))
);

CREATE INDEX IF NOT EXISTS "cashflow_entries_tenant_date_idx"
  ON "cashflow_entries" ("tenant_id", "date");

-- Seed shared system categories. Idempotent via the partial unique index
-- on (kind, name) WHERE is_system.
INSERT INTO "cashflow_categories" ("name", "kind", "is_system", "sort_order") VALUES
  ('Modal',       'income',  true, 1),
  ('Penjualan',   'income',  true, 2),
  ('Lain-lain',   'income',  true, 3),
  ('Gaji',        'expense', true, 1),
  ('Sewa',        'expense', true, 2),
  ('Listrik',     'expense', true, 3),
  ('Air',         'expense', true, 4),
  ('Internet',    'expense', true, 5),
  ('Bahan Baku',  'expense', true, 6),
  ('Operasional', 'expense', true, 7),
  ('Pajak',       'expense', true, 8),
  ('Lain-lain',   'expense', true, 9)
ON CONFLICT DO NOTHING;
