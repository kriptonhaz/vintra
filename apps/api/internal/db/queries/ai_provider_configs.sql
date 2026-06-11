-- name: GetAiProviderConfig :one
-- Connection record by id. Pricing/capability live in ai_provider_capabilities.
SELECT * FROM ai_provider_configs WHERE id = $1;

-- name: GetDefaultAiProviderConfig :one
-- The connection whose TEXT capability is the platform default — used by the
-- ai:reply worker. Returns pgx.ErrNoRows when no default text provider exists.
SELECT c.id, c.name, c.provider_type, c.model, c.base_url, c.api_key,
       c.is_active, c.created_at, c.updated_at
FROM ai_provider_configs c
JOIN ai_provider_capabilities cap ON cap.config_id = c.id
WHERE cap.capability = 'text' AND cap.is_default = true
  AND c.is_active = true AND cap.is_active = true
LIMIT 1;

-- name: GetAiProviderTextPricing :one
-- Per-1M-token pricing for a config's text capability. Returns pgx.ErrNoRows
-- when the config has no text capability — the caller then falls back to the
-- hardcoded ai/pricing.go table.
SELECT input_price_per_1m_usd, input_cache_hit_price_per_1m_usd, output_price_per_1m_usd
FROM ai_provider_capabilities
WHERE config_id = $1 AND capability = 'text';

-- name: ListActiveAiProviderConfigs :many
-- Tenant-facing list — active text-capable providers for the WhatsApp
-- instance "Provider — Model" selector. NEVER returns api_key or base_url.
SELECT c.id, c.name, c.provider_type, c.model, cap.is_default
FROM ai_provider_configs c
JOIN ai_provider_capabilities cap ON cap.config_id = c.id
WHERE c.is_active = true AND cap.is_active = true AND cap.capability = 'text'
ORDER BY cap.is_default DESC, c.name ASC;
