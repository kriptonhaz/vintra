-- name: RecordAiUsage :one
-- Inserts one row per AI call. Called by the UsageRecorder regardless
-- of success or failure — error rows have status='error' and non-zero
-- error_message; success rows have status='success' and non-zero tokens.
INSERT INTO ai_usage_logs (
  tenant_id, feature, provider, model,
  input_tokens, output_tokens, cost_usd,
  latency_ms, status, error_message
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: MonthlyAiCost :one
-- Returns the sum of cost_usd for all successful AI calls this
-- calendar month for the given tenant. Returns "0" when there are no
-- rows. Cast to text so pgx scans into a Go string rather than the
-- pgtype.Numeric struct (which serializes as an opaque blob and breaks
-- the frontend parseFloat).
SELECT COALESCE(SUM(cost_usd), 0)::text
FROM ai_usage_logs
WHERE tenant_id = $1
  AND date_trunc('month', created_at) = date_trunc('month', now())
  AND status = 'success';

-- name: MonthlyAiUsageByProvider :many
-- Per-provider breakdown for the tenant's monthly AI usage widget.
-- Groups by provider so the UI can show cost + message count per provider.
-- total_cost is cast to text (see MonthlyAiCost comment) so the API can
-- forward it to the frontend as a parseable decimal string.
SELECT
  provider,
  COUNT(*)::int                      AS message_count,
  COALESCE(SUM(cost_usd), 0)::text   AS total_cost
FROM ai_usage_logs
WHERE tenant_id = $1
  AND date_trunc('month', created_at) = date_trunc('month', now())
  AND status = 'success'
GROUP BY provider
ORDER BY provider;
