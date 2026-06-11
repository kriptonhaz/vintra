-- Konten credit foundation — per-tenant balance + append-only ledger.
--
-- 1 credit = 1 AI image generation. Topped up by platform admins (no
-- payment gateway yet). konten_credit_accounts.balance is a cached running
-- total; it is only ever mutated alongside a konten_credit_ledger row in
-- the same transaction, so the ledger stays the reconcilable source of
-- truth.
--
-- Rollback:
--   DROP TABLE "konten_credit_ledger";
--   DROP TABLE "konten_credit_accounts";

CREATE TABLE IF NOT EXISTS "konten_credit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "konten_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"type" text NOT NULL,
	"ref_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "konten_credit_accounts" ADD CONSTRAINT "konten_credit_accounts_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "konten_credit_ledger" ADD CONSTRAINT "konten_credit_ledger_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "konten_credit_accounts_tenant_uniq" ON "konten_credit_accounts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "konten_credit_ledger_tenant_time_idx" ON "konten_credit_ledger" ("tenant_id","created_at");
