-- Per-branch receipt overrides for footer + logo.
--
-- Until now `pos_settings.receipt_footer_text` + `receipt_logo_key`
-- were tenant-wide singletons. Multi-branch tenants (Bisnis 3 outlets,
-- Multi-Outlet unlimited) couldn't have per-outlet branding — every
-- branch printed the same address line.
--
-- Move both fields to the `branches` table as nullable overrides; the
-- tenant-level setting on `pos_settings` becomes the default that any
-- branch with NULL inherits. Receipt rendering reads
--   COALESCE(branches.receipt_footer_text, pos_settings.receipt_footer_text)
-- so single-branch tenants see zero behaviour change.
--
-- The single-branch ergonomic stays: settings page only renders the
-- "per-branch" tab when a tenant has > 1 branch; the existing tenant
-- form keeps editing pos_settings as before.

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "receipt_footer_text" text,
  ADD COLUMN IF NOT EXISTS "receipt_logo_key" text;
