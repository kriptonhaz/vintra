-- Internal marketing commission program — Phase 1 data model.
--
-- Layers an internal referral system on top of the existing tenant-to-tenant
-- referral tables. Vintra's own people (members of an internal tenant) form a
-- two-level head→staff tree and earn commission when tenants they refer pay
-- for paid modules. The existing referral pipeline (attribution, discount,
-- recurring credit, clawback, claims) is extended with an owner/beneficiary
-- abstraction rather than forked.
--
-- All additive + idempotent (IF NOT EXISTS) so it is safe to re-apply.

-- ── tenants: mark the internal Vintra org ───────────────────────────
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "is_internal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- ── marketing_agents ────────────────────────────────────────────────
-- Two-level tree: role='head' (parent_agent_id NULL) manages role='staff'
-- (parent_agent_id → head). Scoped per user_id; all agents share one
-- internal tenant. Allocation columns encode the cap-allocation tree:
--   head.cap_pct (admin sets, ≤ global cap)
--     └─ staff.head_override_pct + staff.staff_budget_pct ≤ head.cap_pct
--          └─ staff's code: discount_pct + commission_pct ≤ staff_budget_pct
CREATE TABLE IF NOT EXISTS "marketing_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL UNIQUE,
  "role" text NOT NULL,
  "parent_agent_id" uuid REFERENCES "marketing_agents"("id"),
  "cap_pct" numeric(5, 2),
  "staff_budget_pct" numeric(5, 2),
  "head_override_pct" numeric(5, 2),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "marketing_agents_role_chk" CHECK ("role" IN ('head', 'staff'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_agents_tenant_idx"
  ON "marketing_agents" ("tenant_id", "is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_agents_parent_idx"
  ON "marketing_agents" ("parent_agent_id");
--> statement-breakpoint

-- ── referral_codes: agent ownership ─────────────────────────────────
ALTER TABLE "referral_codes"
  ADD COLUMN IF NOT EXISTS "owner_type" text NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE "referral_codes"
  ADD COLUMN IF NOT EXISTS "owner_agent_id" uuid REFERENCES "marketing_agents"("id");
--> statement-breakpoint

-- ── referral_attributions: agent snapshots ──────────────────────────
ALTER TABLE "referral_attributions"
  ADD COLUMN IF NOT EXISTS "owner_type" text NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE "referral_attributions"
  ADD COLUMN IF NOT EXISTS "staff_agent_id" uuid REFERENCES "marketing_agents"("id");
--> statement-breakpoint
ALTER TABLE "referral_attributions"
  ADD COLUMN IF NOT EXISTS "head_agent_id" uuid REFERENCES "marketing_agents"("id");
--> statement-breakpoint
ALTER TABLE "referral_attributions"
  ADD COLUMN IF NOT EXISTS "head_override_pct_snapshot" numeric(5, 2);
--> statement-breakpoint

-- ── referral_commissions: agent beneficiary ─────────────────────────
ALTER TABLE "referral_commissions"
  ADD COLUMN IF NOT EXISTS "beneficiary_type" text NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE "referral_commissions"
  ADD COLUMN IF NOT EXISTS "beneficiary_agent_id" uuid REFERENCES "marketing_agents"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_commissions_beneficiary_agent_idx"
  ON "referral_commissions" ("beneficiary_agent_id", "status");
--> statement-breakpoint

-- ── tenant_payout_methods: agent ownership ──────────────────────────
ALTER TABLE "tenant_payout_methods"
  ADD COLUMN IF NOT EXISTS "owner_type" text NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE "tenant_payout_methods"
  ADD COLUMN IF NOT EXISTS "owner_agent_id" uuid REFERENCES "marketing_agents"("id");
--> statement-breakpoint

-- ── referral_claim_requests: agent ownership ────────────────────────
ALTER TABLE "referral_claim_requests"
  ADD COLUMN IF NOT EXISTS "owner_type" text NOT NULL DEFAULT 'tenant';
--> statement-breakpoint
ALTER TABLE "referral_claim_requests"
  ADD COLUMN IF NOT EXISTS "owner_agent_id" uuid REFERENCES "marketing_agents"("id");
