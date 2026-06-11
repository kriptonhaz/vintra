-- JUR-185: Public slug for the subdomain MVP.
--
-- Adds tenants.public_slug — nullable, partially unique. Null = tenant
-- hasn't claimed a public URL yet; once claimed, must be unique tenant-
-- wide. Used by nginx (matches subdomain to slug) and the public queue
-- page route (looks up tenant by slug).
--
-- Distinct from tenants.slug (auto-generated owner identifier, ugly URL-
-- unfriendly). public_slug is the tenant-chosen vanity URL component.
--
-- Partial unique index allows multiple tenants to have NULL public_slug
-- (most tenants today) while still preventing two tenants from claiming
-- the same slug.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "public_slug" text;

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_public_slug_unique_idx"
  ON "tenants" ("public_slug")
  WHERE "public_slug" IS NOT NULL;
