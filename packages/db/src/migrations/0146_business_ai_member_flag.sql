-- Per-member opt-in for Vintra AI.
--
-- The tier decides whether a business has the assistant; this decides which
-- staff may use it. The assistant can read sales, cashflow and margin
-- figures, which an owner may not want every cashier seeing — so it defaults
-- to OFF and owners bypass it entirely in `requireBusinessAiAccess`.
--
-- Hand-written to match every migration since 0006; see CLAUDE.md.
-- Additive + idempotent so it is safe to re-apply.

ALTER TABLE "tenant_members"
  ADD COLUMN IF NOT EXISTS "ai_enabled" boolean NOT NULL DEFAULT false;
