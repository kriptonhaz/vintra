-- referral_codes
CREATE TABLE IF NOT EXISTS referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text UNIQUE NOT NULL,
  label text,
  discount_pct numeric(5,2) NOT NULL,
  commission_pct numeric(5,2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_pct_check CHECK (
    discount_pct >= 0 AND commission_pct >= 0 AND discount_pct + commission_pct <= 100
  )
);

CREATE INDEX IF NOT EXISTS referral_codes_tenant_active_idx
  ON referral_codes(tenant_id, is_active);

-- referral_attributions
CREATE TABLE IF NOT EXISTS referral_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  code_id uuid NOT NULL REFERENCES referral_codes(id),
  referrer_tenant_id uuid NOT NULL REFERENCES tenants(id),
  discount_pct_snapshot numeric(5,2) NOT NULL,
  commission_pct_snapshot numeric(5,2) NOT NULL,
  window_months int NOT NULL DEFAULT 12,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  window_ends_at timestamptz NOT NULL,
  CONSTRAINT referral_attributions_no_self_referral CHECK (
    referee_tenant_id != referrer_tenant_id
  )
);

CREATE INDEX IF NOT EXISTS referral_attributions_referrer_idx
  ON referral_attributions(referrer_tenant_id, attributed_at);

-- referral_claim_requests (declared before referral_commissions for FK)
CREATE TABLE IF NOT EXISTS referral_claim_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payout_method_id uuid NOT NULL,
  total_amount_idr numeric(15,2) NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid,
  admin_notes text,
  transfer_proof_key text
);

CREATE INDEX IF NOT EXISTS referral_claim_requests_status_idx
  ON referral_claim_requests(status, submitted_at);

-- referral_commissions
CREATE TABLE IF NOT EXISTS referral_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id uuid NOT NULL REFERENCES referral_attributions(id),
  referrer_tenant_id uuid NOT NULL,
  amount_idr numeric(15,2) NOT NULL,
  source_invoice_id uuid,
  status text NOT NULL DEFAULT 'pending',
  pending_until timestamptz NOT NULL,
  claimable_at timestamptz,
  claim_request_id uuid REFERENCES referral_claim_requests(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_commissions_referrer_status_idx
  ON referral_commissions(referrer_tenant_id, status, pending_until);

-- tenant_payout_methods
CREATE TABLE IF NOT EXISTS tenant_payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_holder_name text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK from referral_claim_requests to tenant_payout_methods now that it exists
ALTER TABLE referral_claim_requests
  DROP CONSTRAINT IF EXISTS referral_claim_requests_payout_method_id_fkey;
ALTER TABLE referral_claim_requests
  ADD CONSTRAINT referral_claim_requests_payout_method_id_fkey
  FOREIGN KEY (payout_method_id) REFERENCES tenant_payout_methods(id);

-- referral_global_config
CREATE TABLE IF NOT EXISTS referral_global_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_pct numeric(5,2) NOT NULL DEFAULT 20.00,
  default_window_months int NOT NULL DEFAULT 12,
  clawback_days int NOT NULL DEFAULT 14,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Seed default row if not present
INSERT INTO referral_global_config (cap_pct, default_window_months, clawback_days)
SELECT 20.00, 12, 14
WHERE NOT EXISTS (SELECT 1 FROM referral_global_config);
