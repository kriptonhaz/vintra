-- JUR-176 follow-up: maintenance mode for tenant public sites.
--
-- Two columns added to tenant_sites:
--
-- 1. maintenance_mode (boolean, default false). When true, the public
--    renderer short-circuits the normal site response and shows a
--    branded "under construction" page. published_settings stays
--    intact so flipping the flag back off restores the site instantly
--    (no re-publish needed).
--
-- 2. maintenance_message (text, nullable). Optional custom copy shown
--    on the maintenance page. Null = use the localized default
--    ("Halaman publik usaha kami sedang diperbarui").
--
-- Both columns are nullable-or-defaulted so the migration is safe on
-- existing rows (mantra + any other early adopters).

ALTER TABLE "tenant_sites"
  ADD COLUMN IF NOT EXISTS "maintenance_mode" boolean NOT NULL DEFAULT false;

ALTER TABLE "tenant_sites"
  ADD COLUMN IF NOT EXISTS "maintenance_message" text;
