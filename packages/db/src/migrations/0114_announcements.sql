-- Pengumuman (announcements) — tenant-level broadcasts authored by
-- owners/admins for their staff. Delivery + read-tracking ride the
-- existing notifications table (one fan-out row per recipient on
-- publish), so this table holds only the canonical content + audience
-- + publish status. audience='branch' / status drafts are reserved for
-- Phase 2; the columns exist now so we don't re-migrate later.

CREATE TABLE "announcements" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "author_user_id"  uuid NOT NULL,
  "title"           text NOT NULL,
  "body"            text NOT NULL,
  "audience"        text NOT NULL DEFAULT 'all',
  "branch_id"       uuid,
  "pinned"          boolean NOT NULL DEFAULT false,
  "status"          text NOT NULL DEFAULT 'draft',
  "published_at"    timestamp,
  "expires_at"      timestamp,
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "updated_at"      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "announcements_audience_chk" CHECK ("audience" IN ('all', 'branch')),
  CONSTRAINT "announcements_status_chk"   CHECK ("status"   IN ('draft', 'published'))
);

-- Read hot path: published announcements for a tenant, newest first.
CREATE INDEX "announcements_tenant_published_idx"
  ON "announcements" ("tenant_id", "published_at");
