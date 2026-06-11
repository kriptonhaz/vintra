-- name: GetOptInTenantMemberByPhone :one
-- Single-shot lookup for the inbound detector + verify endpoint.
-- Phones are normalized to "62XXXXXXXXXX" at every write boundary
-- (coerceStorablePhone in @vintra/shared) plus a one-shot backfill
-- in migration 0074, so direct equality is safe. Backed by the partial
-- index `tenant_members_wa_login_phone_idx` (also in 0074) —
-- O(log N) over only the opt-in subset for this tenant.
SELECT
  tm.id,
  tm.tenant_id,
  tm.user_id,
  tm.role,
  tm.phone,
  tm.wa_login_email,
  t.slug AS tenant_slug,
  t.business_name
FROM tenant_members tm
JOIN tenants t ON t.id = tm.tenant_id
WHERE tm.tenant_id = $1
  AND tm.phone = $2
  AND tm.wa_login_enabled = true
LIMIT 1;

-- name: GetWaInstanceForLogin :one
-- Public-safe lookup that returns the connected, paid-tier, OTP-enabled
-- WA instance for a tenant so the login page can build the wa.me deep
-- link. Tier check gates the feature on basic+ subscribers; the per-
-- instance toggle (otp_login_enabled) is the owner's kill switch.
SELECT
  wi.id,
  wi.phone_number,
  wi.status,
  wi.otp_login_enabled,
  ws.tier
FROM wa_instances wi
JOIN wa_settings ws ON ws.tenant_id = wi.tenant_id
WHERE wi.tenant_id = $1
  AND wi.status = 'connected'
  AND wi.otp_login_enabled = true
  AND ws.subscription_active = true
  AND ws.tier IN ('basic', 'komplit', 'enterprise')
LIMIT 1;

-- name: GetInstanceForOtp :one
-- Variant used by the inbound detector: looks up the instance by id
-- (not tenant) and returns the flag + tier check. Bypasses tenant
-- scoping because the inbound worker already has the tenant from the
-- inbound payload — this query is just verifying the feature is on
-- for THIS instance before generating a code.
SELECT
  wi.id,
  wi.tenant_id,
  wi.otp_login_enabled,
  ws.tier,
  ws.subscription_active
FROM wa_instances wi
JOIN wa_settings ws ON ws.tenant_id = wi.tenant_id
WHERE wi.id = $1
LIMIT 1;

-- name: InvalidatePriorWaLoginOtps :exec
-- Marks every prior unconsumed OTP for (tenant, phone) as consumed
-- before inserting a new one. Prevents the user accidentally typing an
-- older code when multiple OTP requests are in flight (e.g. they hit
-- "kirim ulang" twice before the first reply arrived).
UPDATE wa_login_otps
SET consumed_at = now()
WHERE tenant_id = $1
  AND phone = $2
  AND consumed_at IS NULL;

-- name: CreateWaLoginOtp :one
-- Inserts a freshly-generated OTP row. The plaintext code is hashed
-- before this call and discarded — only otp_hash lives in the DB.
INSERT INTO wa_login_otps (
  tenant_id, instance_id, phone, remote_jid, otp_hash, expires_at
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id;

-- name: GetActiveWaLoginOtp :one
-- Hot path for the verify endpoint. Locks the row FOR UPDATE so the
-- attempts-counter increment + consume happens atomically against
-- concurrent attempts from the same phone.
SELECT id, otp_hash, attempts, expires_at
FROM wa_login_otps
WHERE tenant_id = $1
  AND phone = $2
  AND consumed_at IS NULL
  AND expires_at > now()
ORDER BY created_at DESC
LIMIT 1
FOR UPDATE;

-- name: IncrementWaLoginOtpAttempts :exec
UPDATE wa_login_otps
SET attempts = attempts + 1
WHERE id = $1;

-- name: ConsumeWaLoginOtp :exec
-- Marks the OTP as used. Set after a successful verify OR after the
-- 3rd failed attempt — either way the row is dead and the user must
-- request a new code via WhatsApp.
UPDATE wa_login_otps
SET consumed_at = now()
WHERE id = $1;

-- name: DeleteStaleWaLoginOtps :execrows
-- Cleanup helper for the boot-time goroutine in cmd/api. Deletes
-- consumed OR expired rows older than 30 days so the table doesn't
-- grow unbounded. 30 days is well past any audit window we care about
-- — the verify-success slog line is the durable record. Returns the
-- row count so the boot log can announce how many it removed.
DELETE FROM wa_login_otps
WHERE (consumed_at IS NOT NULL OR expires_at < now())
  AND created_at < now() - interval '30 days';
