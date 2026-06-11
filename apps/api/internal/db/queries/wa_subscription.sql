-- name: GetWaSubscriptionPlan :one
SELECT * FROM wa_subscription_plans WHERE plan_key = $1;

-- name: GetWaSettings :one
SELECT * FROM wa_settings WHERE tenant_id = $1;

-- name: UpsertWaSettings :one
INSERT INTO wa_settings (tenant_id, tier, subscription_active)
VALUES ($1, 'free', false)
ON CONFLICT (tenant_id) DO UPDATE SET updated_at = now()
RETURNING *;

-- name: UpdateWaSettings :one
UPDATE wa_settings
SET tier = $2,
    subscription_active = $3,
    subscription_expires_at = $4,
    updated_at = now()
WHERE tenant_id = $1
RETURNING *;

-- name: CountMonthlyAiReplies :one
SELECT COUNT(*)::int FROM ai_usage_logs
WHERE tenant_id = $1
  AND feature = 'wa_reply'
  AND status = 'success'
  AND date_trunc('month', created_at) = date_trunc('month', now());

-- name: CountTenantWaInstances :one
SELECT COUNT(*)::int FROM wa_instances WHERE tenant_id = $1;
