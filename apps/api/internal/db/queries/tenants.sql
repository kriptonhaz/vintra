-- name: GetTenant :one
-- Looks up a tenant by primary key. Used by the ai:reply worker to
-- pull business name + category for the prompt system context block.
-- No tenant-scoping needed here — the caller already has the tenantID
-- from the authenticated request context.
SELECT * FROM tenants WHERE id = $1 LIMIT 1;

-- name: GetTenantBySlug :one
-- Public-safe lookup by URL slug. Used by the unauthenticated WA login
-- endpoints to resolve /login/wa/{slug} → tenant_id. Returns only the
-- fields the public flow needs (id, slug, business_name) — never plan
-- or other internal metadata.
SELECT id, slug, business_name
FROM tenants
WHERE slug = $1
LIMIT 1;
