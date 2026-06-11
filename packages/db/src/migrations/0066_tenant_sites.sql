-- JUR-176: Tenant public-site state + publish history.
--
-- Two tables:
--
-- 1. tenant_sites — one row per tenant (PK = tenant_id). Holds the
--    current draft (settings, template_id) and the currently-live
--    snapshot (published_settings, published_template_id, published_at).
--    Both blobs coexist so a tenant can keep editing after publishing
--    without affecting what customers see at <slug>.vintra.my.id.
--    No `status` column — derive "is live" from `published_settings
--    IS NOT NULL`; a single enum can't represent "live + dirty draft".
--
-- 2. site_publish_history — append-only snapshot per publish event.
--    Trimmed to last 5 per tenant by publishSite() in the same
--    transaction. Powers the "Riwayat publikasi" / Pulihkan flow.
--    Not an audit log; just an undo affordance.
--
-- Tenant slug stays on tenants.public_slug (JUR-185). We JOIN at read
-- time rather than data-migrate so JUR-185 routing keeps working
-- unchanged.

CREATE TABLE IF NOT EXISTS "tenant_sites" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "template_id" text NOT NULL,
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "published_template_id" text,
  "published_settings" jsonb,
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "site_publish_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "template_id" text NOT NULL,
  "settings" jsonb NOT NULL,
  "published_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Supports "list this tenant's last 5 publish events in reverse order"
-- + the trim query in publishSite() which deletes everything past row 5.
CREATE INDEX IF NOT EXISTS "site_publish_history_tenant_published_idx"
  ON "site_publish_history" ("tenant_id", "published_at");
