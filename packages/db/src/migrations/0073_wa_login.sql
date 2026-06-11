-- WhatsApp OTP login (PR 1 of the wa-login series).
--
-- Adds the schema bits the inbound detector + verify endpoint will use:
--   - `wa_login_otps`              new table, short-lived 6-digit codes
--   - `wa_instances.otp_login_enabled`  per-instance kill switch
--   - `tenant_members.wa_login_enabled` per-member opt-in
--   - `tenant_members.wa_login_email`   synthetic Supabase email for
--                                       phone-only staff (no real email)
--
-- All additive — no existing rows change behavior until owners flip the
-- new flags. Safe to roll out before the inbound handler is wired up;
-- the handler is gated on `otp_login_enabled = true` so unsetting it
-- everywhere is a clean rollback.

-- ── tenant_members ────────────────────────────────────────────────
-- Phone column already exists from the HR profile fields. Add the two
-- WA-login flags. wa_login_email is UNIQUE because the synthetic format
-- (wa-{tenantSlug}-{e164Phone}@login.vintra.local) must never collide
-- across tenants — Supabase Auth keys users by email.
ALTER TABLE "tenant_members"
  ADD COLUMN IF NOT EXISTS "wa_login_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "wa_login_email" text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_members_wa_login_email_unique'
  ) THEN
    ALTER TABLE "tenant_members"
      ADD CONSTRAINT "tenant_members_wa_login_email_unique" UNIQUE ("wa_login_email");
  END IF;
END $$;

-- ── wa_instances ──────────────────────────────────────────────────
-- Per-instance toggle. The inbound handler checks this BEFORE running
-- the OTP-request regex, so the cost on instances that haven't enabled
-- login is zero. Default off — owner opts in from the instance config
-- sheet once staff phones are populated.
ALTER TABLE "wa_instances"
  ADD COLUMN IF NOT EXISTS "otp_login_enabled" boolean NOT NULL DEFAULT false;

-- ── wa_login_otps ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wa_login_otps" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "wa_instances" ("id") ON DELETE CASCADE,
  "phone"       text NOT NULL,
  "remote_jid"  text NOT NULL,
  "otp_hash"    text NOT NULL,
  "expires_at"  timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "attempts"    integer NOT NULL DEFAULT 0,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

-- Hot path: "latest unconsumed unexpired OTP for (tenant, phone)" —
-- the verify endpoint hits this on every login attempt.
CREATE INDEX IF NOT EXISTS "wa_login_otps_lookup_idx"
  ON "wa_login_otps" ("tenant_id", "phone", "expires_at");
