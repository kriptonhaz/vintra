-- name: CreateWaInstance :one
-- Creates a new WhatsApp instance for a tenant. Status starts at
-- 'disconnected' (the table default). AI config takes its defaults
-- from the table; tenant can patch via UpdateWaInstance later.
INSERT INTO wa_instances (tenant_id, label)
VALUES ($1, $2)
RETURNING *;

-- name: ListWaInstancesByTenant :many
-- Lists every wa_instance for a tenant, newest first.
SELECT * FROM wa_instances
WHERE tenant_id = $1
ORDER BY created_at DESC;

-- name: GetWaInstance :one
-- Tenant-scoped lookup by id. Returns ErrNoRows for both
-- "doesn't exist" and "exists but belongs to a different tenant" —
-- callers convert to 404, never 403, to prevent id enumeration.
SELECT * FROM wa_instances
WHERE id = $1 AND tenant_id = $2
LIMIT 1;

-- name: UpdateWaInstance :one
-- Partial update. Each column uses COALESCE(sqlc.narg(...), col)
-- so callers pass nil for fields they don't want to touch. The
-- Go struct uses pgtype.Text / pgtype.Bool / etc. with .Valid as
-- the "is set" flag.
UPDATE wa_instances
SET
  label                       = COALESCE(sqlc.narg('label'), label),
  ai_enabled                  = COALESCE(sqlc.narg('ai_enabled'), ai_enabled),
  ai_provider                 = COALESCE(sqlc.narg('ai_provider'), ai_provider),
  ai_model                    = COALESCE(sqlc.narg('ai_model'), ai_model),
  ai_system_prompt            = COALESCE(sqlc.narg('ai_system_prompt'), ai_system_prompt),
  ai_temperature              = COALESCE(sqlc.narg('ai_temperature'), ai_temperature),
  ai_max_history              = COALESCE(sqlc.narg('ai_max_history'), ai_max_history),
  ai_provider_config_id       = COALESCE(sqlc.narg('ai_provider_config_id'), ai_provider_config_id),
  admin_phone                 = COALESCE(sqlc.narg('admin_phone'), admin_phone),
  handoff_auto_resume_hours   = COALESCE(sqlc.narg('handoff_auto_resume_hours'), handoff_auto_resume_hours),
  otp_login_enabled           = COALESCE(sqlc.narg('otp_login_enabled'), otp_login_enabled),
  updated_at                  = now()
WHERE id = $1 AND tenant_id = $2
RETURNING *;

-- name: ClearWaInstanceAiProviderConfig :exec
-- Used by PATCH to explicitly unpin an instance's provider config (back to
-- "use platform default"). The normal UpdateWaInstance can't express this
-- because its COALESCE treats NULL as "leave alone".
UPDATE wa_instances
SET ai_provider_config_id = NULL, updated_at = now()
WHERE id = $1 AND tenant_id = $2;

-- name: DeleteWaInstance :execrows
-- Returns the number of rows deleted so the handler can return 404
-- when nothing matched (id wrong OR tenant mismatch). FK cascades
-- defined in migration 0036 handle wa_messages + wa_contacts cleanup.
DELETE FROM wa_instances
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateWaInstanceStatus :exec
-- Internal helper for the whatsmeow provider — flips status + the
-- bookkeeping columns when the socket reconnects, drops, or logs out.
-- Used by JUR-65/JUR-66, kept here so all wa_instance writes live in
-- one file.
--
-- phone_number is COALESCEd with the optional narg so the subscriber
-- can pass the paired E.164 digits on ConnectedEvent (where whatsmeow's
-- Store.ID is available) without clobbering existing values on
-- DisconnectedEvent / LoggedOutEvent (where no JID is in hand).
UPDATE wa_instances
SET
  status                  = $2,
  last_disconnect_reason  = sqlc.narg('last_disconnect_reason'),
  last_connected_at       = CASE WHEN $2 = 'connected' THEN now() ELSE last_connected_at END,
  phone_number            = COALESCE(sqlc.narg('phone_number'), phone_number),
  updated_at              = now()
WHERE id = $1;

-- name: ListWaInstancesForRevival :many
-- Called on api boot. Returns instances whose status suggests we
-- should attempt to reattach them (skips logged_out / banned —
-- those need explicit user re-pairing). Used by the registry's
-- Revive() in JUR-66.
SELECT id FROM wa_instances
WHERE status IN ('connected', 'connecting');

-- name: GetInstanceTenantID :one
-- Bypasses tenant scoping — caller is the registry, which needs
-- to know an instance's tenant_id to attach the inbound subscriber.
-- HTTP callers must NOT use this; they use GetWaInstance with the
-- caller's tenant_id for proper authorization.
SELECT tenant_id FROM wa_instances
WHERE id = $1;
