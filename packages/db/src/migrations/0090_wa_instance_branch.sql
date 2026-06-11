-- Phase 3 — WhatsApp per-branch. Add branch_id to wa_instances so a
-- franchise can run a separate WhatsApp number per outlet (sold as a
-- per-branch add-on; entitlement is checked against
-- branches.enabled_modules).
--
-- NULLABLE: existing instances stay tenant-level / unassigned. FK is
-- ON DELETE SET NULL — removing a branch must not drop its WA history.
--
-- Safe for the running Go API (apps/api): its sqlc queries select and
-- insert explicit column lists, so a new nullable column is inert
-- until the Go create-handler is taught to populate it.
--
-- Rollback:
--   ALTER TABLE "wa_instances" DROP COLUMN IF EXISTS "branch_id";

ALTER TABLE "wa_instances" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wa_instances" ADD CONSTRAINT "wa_instances_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_instances_branch_idx" ON "wa_instances" USING btree ("branch_id");
