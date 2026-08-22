-- Let a tenant hide the cashier's promo-code box.
--
-- The box currently appears for every tenant whose tier includes
-- `promo_codes`, whether or not they run promotions. For the many that
-- never do, it is a permanent empty field between the cart and the
-- discount control — one more thing for a cashier to scan past on every
-- sale.
--
-- Defaults to TRUE, not FALSE: tenants who ARE running promo codes today
-- must not lose the field the moment this ships. Opting out is the new
-- capability; the current behaviour stays the default.
--
-- Presentation only. `createSale` still honours a valid promo code sent
-- with the sale, because this is a decluttering preference and not an
-- anti-fraud control like `adhoc_items_enabled` — rejecting a genuine
-- discount over a UI setting would cost the customer real money.
--
-- Hand-written to match every migration since 0006; see CLAUDE.md.
-- Additive + idempotent so it is safe to re-apply.

ALTER TABLE "pos_settings"
  ADD COLUMN IF NOT EXISTS "promo_code_field_enabled" boolean NOT NULL DEFAULT true;
