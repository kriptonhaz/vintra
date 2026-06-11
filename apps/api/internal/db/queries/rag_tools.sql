-- name: ListActiveRagTools :many
SELECT * FROM wa_rag_tools
WHERE is_active = true
ORDER BY sort_order;

-- name: GetInstanceEnabledRagTools :many
SELECT wrt.*, irt.enabled
FROM wa_instance_rag_tools irt
JOIN wa_rag_tools wrt ON irt.rag_tool_id = wrt.id
JOIN wa_instances wi ON irt.instance_id = wi.id
WHERE irt.instance_id = $1
  AND wi.tenant_id = $2
  AND irt.enabled = true
  AND wrt.is_active = true
ORDER BY wrt.sort_order;

-- name: ListInstanceRagToolsWithState :many
-- Returns all active tools with enabled state for a given instance (default false if no row).
SELECT
  wrt.*,
  COALESCE(irt.enabled, false) AS enabled
FROM wa_rag_tools wrt
LEFT JOIN wa_instance_rag_tools irt
  ON irt.rag_tool_id = wrt.id AND irt.instance_id = $1
JOIN wa_instances wi ON wi.id = $1
WHERE wrt.is_active = true
  AND wi.tenant_id = $2
ORDER BY wrt.sort_order;

-- name: UpsertInstanceRagTool :exec
INSERT INTO wa_instance_rag_tools (instance_id, rag_tool_id, enabled)
VALUES ($1, $2, $3)
ON CONFLICT (instance_id, rag_tool_id) DO UPDATE SET enabled = $3;

-- name: SeedDefaultRagToolsForInstance :exec
-- Seed enabled=true rows for every active basic-tier RAG tool for the
-- given instance. ON CONFLICT DO NOTHING preserves any explicit user
-- choice already in the table (so re-running for an existing instance
-- doesn't clobber custom toggles). Called once at instance creation
-- so new tenants land with the basic RAG suite ready to go instead of
-- silently disabled.
INSERT INTO wa_instance_rag_tools (instance_id, rag_tool_id, enabled)
SELECT $1, id, true
FROM wa_rag_tools
WHERE is_active = true AND min_tier = 'basic'
ON CONFLICT (instance_id, rag_tool_id) DO NOTHING;

-- name: GetRagToolByID :one
SELECT * FROM wa_rag_tools WHERE id = $1;

-- name: VerifyInstanceTenant :one
-- Used by the tenant-facing RAG toggle handlers to confirm an instance
-- belongs to the calling tenant before reading/writing.
SELECT id FROM wa_instances WHERE id = $1 AND tenant_id = $2;
