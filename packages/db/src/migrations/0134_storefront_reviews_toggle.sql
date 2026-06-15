-- Storefront per-tenant toggle for product ratings & reviews. Default
-- on (matches the launch behaviour). When off, the storefront hides
-- review forms + rating summaries and the submit path is rejected.
-- Idempotent in case applied out-of-band.

ALTER TABLE "storefront_settings"
  ADD COLUMN IF NOT EXISTS "reviews_enabled" boolean NOT NULL DEFAULT true;
