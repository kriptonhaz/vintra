-- Anti-fraud "Item Lain" (ad-hoc cashier line) toggle. Ad-hoc lines
-- carry no item_id, so they bypass the catalog + inventory entirely and
-- are hard to audit. Default false: a tenant opts IN from POS settings.
-- The toggle is ungated (reachable on every tier incl. free) so no
-- tenant is trapped without a way to re-enable it. Idempotent in case
-- applied out-of-band.

ALTER TABLE "pos_settings"
  ADD COLUMN IF NOT EXISTS "adhoc_items_enabled" boolean NOT NULL DEFAULT false;
