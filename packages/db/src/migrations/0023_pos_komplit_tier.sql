-- Komplit bundle SKU (JUR-5b). Adds 'komplit' to the pos_settings.tier
-- CHECK constraint so admin payment activation can persist it. The
-- Komplit tier behaves as a superset of Toko (all Toko POS features
-- + Phase 2 features like loyalty, promo, line discount that ship in
-- W2-W3) PLUS bundles inventory + attendance activation in the same
-- payment.

ALTER TABLE "pos_settings" DROP CONSTRAINT IF EXISTS "pos_tier_chk";
ALTER TABLE "pos_settings"
  ADD CONSTRAINT "pos_tier_chk"
  CHECK (tier IN ('free', 'toko', 'bisnis', 'multi_outlet', 'komplit'));
