-- Phase 4 — per-branch situs. `branch_sites` holds one public site per
-- outlet, used when tenants.situs_mode = 'per_branch'. A separate table
-- (not a branch_id column on tenant_sites) keeps the single-mode site
-- — keyed by tenant_id PK, one row per tenant — completely untouched.
--
-- Mirrors tenant_sites: same draft (`settings`) vs published
-- (`published_*`) split and maintenance toggle. `slug` is the
-- per-branch public slug, nullable until claimed.
--
-- Rollback:
--   DROP TABLE IF EXISTS "branch_sites";

CREATE TABLE IF NOT EXISTS "branch_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"slug" text,
	"template_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_template_id" text,
	"published_settings" jsonb,
	"published_at" timestamp,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"maintenance_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "branch_sites" ADD CONSTRAINT "branch_sites_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "branch_sites" ADD CONSTRAINT "branch_sites_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "branch_sites_branch_unique" ON "branch_sites" USING btree ("branch_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "branch_sites_slug_unique" ON "branch_sites" USING btree ("slug") WHERE "slug" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branch_sites_tenant_idx" ON "branch_sites" USING btree ("tenant_id");
