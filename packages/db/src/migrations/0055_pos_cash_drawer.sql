-- JUR-141 Peti Kas (Cash Drawer) — per-cashier shift state for the
-- Komplit-tier POS. Two new tables + two new columns on pos_settings.
--
-- Default behavior: cash_drawer_enabled = true for every existing +
-- new pos_settings row. Owners can flip it OFF via /pos/settings if
-- they don't want the "Buka Kas dulu" wall. Free-tier tenants are
-- gated at the application layer (no UI exposes the feature) so the
-- default doesn't matter for them.

-- ── pos_cash_sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id),
  cashier_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  opening_balance numeric(15,2) NOT NULL,
  opening_notes text,
  opened_at timestamp NOT NULL DEFAULT now(),
  expected_closing numeric(15,2),
  actual_closing numeric(15,2),
  variance numeric(15,2),
  closing_notes text,
  closed_at timestamp,
  cash_in_total numeric(15,2) NOT NULL DEFAULT 0,
  cash_out_total numeric(15,2) NOT NULL DEFAULT 0,
  force_closed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pos_cash_sessions_status_chk
    CHECK (status IN ('open', 'closed'))
);

-- Partial unique index: at most ONE open session per (branch, cashier).
-- Closed sessions accumulate freely so a cashier has a daily history.
CREATE UNIQUE INDEX IF NOT EXISTS pos_cash_sessions_open_per_cashier_uniq
  ON pos_cash_sessions (branch_id, cashier_user_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS pos_cash_sessions_tenant_opened_idx
  ON pos_cash_sessions (tenant_id, opened_at);

CREATE INDEX IF NOT EXISTS pos_cash_sessions_cashier_idx
  ON pos_cash_sessions (cashier_user_id);

-- ── pos_cash_movements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES pos_cash_sessions(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(15,2) NOT NULL,
  reason text,
  reference_sale_id uuid REFERENCES pos_sales(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pos_cash_movements_type_chk
    CHECK (type IN ('sale', 'refund', 'drop', 'payout')),
  -- Cashier-initiated movements need a reason; system-generated don't.
  CONSTRAINT pos_cash_movements_reason_chk
    CHECK ((type IN ('drop', 'payout')) = (reason IS NOT NULL)),
  -- Sale + refund movements always link to the originating sale.
  CONSTRAINT pos_cash_movements_reference_chk
    CHECK ((type IN ('sale', 'refund')) = (reference_sale_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS pos_cash_movements_session_created_idx
  ON pos_cash_movements (session_id, created_at);

CREATE INDEX IF NOT EXISTS pos_cash_movements_tenant_created_idx
  ON pos_cash_movements (tenant_id, created_at);

-- ── pos_settings additions ──────────────────────────────────────
-- cash_drawer_enabled defaults to FALSE so PR 1 (data layer only)
-- ships safely — a TRUE default would block cash sales for every
-- existing Komplit tenant before the PR 2 UI lets them open sessions.
-- PR 4 (JUR-145) flips this to TRUE for Komplit tenants in a one-time
-- UPDATE + changes the column default to TRUE so new onboarding
-- starts opted-in.
ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS cash_drawer_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS cash_variance_threshold numeric(15,2) NOT NULL DEFAULT 10000;
