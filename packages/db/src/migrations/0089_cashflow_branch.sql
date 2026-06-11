-- Phase 2 — cashflow per-branch. Add branch_id to the cashflow tables
-- that were still tenant-only. `cashflow_entries` already carries
-- branch_id (migration 0080-era), so the P&L ledger is unchanged here.
--
-- All columns are NULLABLE: existing rows stay valid as "unassigned /
-- shared" and a multi-branch tenant attributes new rows to an outlet.
-- FK is ON DELETE SET NULL — removing a branch must not cascade-delete
-- a tenant's financial history.
--
-- Rollback:
--   ALTER TABLE "cashflow_accounts" DROP COLUMN IF EXISTS "branch_id";
--   ALTER TABLE "ar_receivables"    DROP COLUMN IF EXISTS "branch_id";
--   ALTER TABLE "ap_payables"       DROP COLUMN IF EXISTS "branch_id";

ALTER TABLE "cashflow_accounts" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
--> statement-breakpoint
ALTER TABLE "ar_receivables" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
--> statement-breakpoint
ALTER TABLE "ap_payables" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cashflow_accounts" ADD CONSTRAINT "cashflow_accounts_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ar_receivables" ADD CONSTRAINT "ar_receivables_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ap_payables" ADD CONSTRAINT "ap_payables_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cashflow_accounts_branch_idx" ON "cashflow_accounts" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ar_receivables_branch_idx" ON "ar_receivables" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ap_payables_branch_idx" ON "ap_payables" USING btree ("branch_id");
