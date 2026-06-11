-- JUR-176 follow-up: page-view ledger for tenant public sites.
--
-- One row per visit. Dedup is best-effort via visitor_hash —
-- sha256(ip + day_salt + slug) so refresh spam from the same
-- visitor in the same day rolls up to ONE unique visitor on the
-- dashboard. Day salt rotates at midnight Asia/Jakarta so
-- "uniques" mean what civilians expect.
--
-- No GeoIP / country yet — deferred until we add a lookup
-- provider. Referrer is captured opportunistically (browsers
-- truncate on https→http hops and most marketing channels these
-- days).
--
-- Storage: ~50 bytes per row. 10k visits/day = 0.5MB/day. We're
-- comfortable here; trimming policy can wait until growth proves
-- it needs one.

CREATE TABLE IF NOT EXISTS "tenant_site_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "viewed_at" timestamp NOT NULL DEFAULT now(),
  "visitor_hash" text NOT NULL,
  "path" text NOT NULL,
  "referrer" text
);

-- Powers every analytics query: "last N days for this tenant" +
-- "COUNT(DISTINCT visitor_hash) WHERE viewed_at > ...". Composite on
-- (tenant_id, viewed_at) so both halves of the filter use the index.
CREATE INDEX IF NOT EXISTS "tenant_site_views_tenant_viewed_idx"
  ON "tenant_site_views" ("tenant_id", "viewed_at");
