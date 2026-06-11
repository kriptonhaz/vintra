-- Per-year monotonic invoice counter. Upsert-on-conflict lets us
-- atomically read-and-increment without a separate SELECT, avoiding
-- the classic lost-update race.
CREATE TABLE "financial_invoice_counters" (
  "year" integer PRIMARY KEY,
  "last_number" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Append-only ledger of manual payments + refunds across modules.
-- `status = 'paid' | 'refund'`; refunds link to the original via
-- `refund_of_transaction_id`.
CREATE TABLE "financial_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_number" text NOT NULL UNIQUE,
  "module_key" text NOT NULL,
  "plan_key" text NOT NULL,
  "period_start_at" timestamp NOT NULL,
  "period_end_at" timestamp NOT NULL,
  "amount_idr" numeric(15, 0) NOT NULL,
  "transfer_date" date NOT NULL,
  "bank_reference" text,
  "proof_photo_key" text,
  "billed_staff_count" integer,
  "notes" text,
  "status" text DEFAULT 'paid' NOT NULL,
  "refund_of_transaction_id" uuid REFERENCES "financial_transactions"("id") ON DELETE set null,
  "recorded_by_user_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "financial_transactions_tenant_created_idx"
  ON "financial_transactions" ("tenant_id", "created_at" DESC);--> statement-breakpoint

CREATE INDEX "financial_transactions_created_idx"
  ON "financial_transactions" ("created_at" DESC);--> statement-breakpoint

CREATE INDEX "financial_transactions_module_status_idx"
  ON "financial_transactions" ("module_key", "status", "created_at" DESC);
