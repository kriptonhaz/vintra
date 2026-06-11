-- Tenant-scope the roles table so each tenant can curate its own
-- custom roles (e.g. "Kasir Pagi") from /settings/roles without
-- polluting other tenants. System roles stay tenant_id NULL.
--
-- Two partial unique indexes replace the global UNIQUE(key) — Postgres
-- treats NULLs as distinct by default, so a plain UNIQUE(tenant_id,
-- key) would let multiple system rows share a key. The split keeps
-- one system "kasir" AND one "kasir" per tenant.
--
-- Rollback:
--   DROP INDEX IF EXISTS "roles_tenant_idx";
--   DROP INDEX IF EXISTS "roles_tenant_key_unique";
--   DROP INDEX IF EXISTS "roles_system_key_unique";
--   ALTER TABLE "roles" ADD CONSTRAINT "roles_key_unique" UNIQUE ("key");
--   ALTER TABLE "roles" DROP COLUMN IF EXISTS "tenant_id";

ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_key_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_system_key_unique" ON "roles" USING btree ("key") WHERE "tenant_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenant_key_unique" ON "roles" USING btree ("tenant_id", "key") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roles_tenant_idx" ON "roles" USING btree ("tenant_id") WHERE "tenant_id" IS NOT NULL;
