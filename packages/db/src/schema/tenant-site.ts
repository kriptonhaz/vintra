import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { branches } from './attendance'

/**
 * JUR-176: per-tenant public landing site state.
 *
 * One row per tenant (tenant_id is PK). Two distinct setting blobs:
 *   - `settings` — current draft. Always editable.
 *   - `publishedSettings` — what's currently live at the public URL.
 *     NULL until first publish; never written outside publishSite().
 *
 * Why two columns instead of a `status` flag: after publishing, the
 * tenant can keep editing — both "the public site is live" and "the
 * tenant has unsaved drafts" are simultaneously true, so a single
 * status enum can't represent it. Publishing is `published_* := *`.
 *
 * `templateId` is the registry key (e.g. `'mini'`, `'warung-modern'`)
 * — see apps/web/src/lib/site-templates/registry.ts. Stored as text
 * because templates live in code, not DB; a check constraint would
 * couple migrations to template lifecycle which we explicitly want
 * to avoid.
 */
export const tenantSites = pgTable('tenant_sites', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull(),
  settings: jsonb('settings').notNull().default({}),
  publishedTemplateId: text('published_template_id'),
  publishedSettings: jsonb('published_settings'),
  publishedAt: timestamp('published_at'),
  /**
   * JUR-176 follow-up: when true, public visitors see a branded
   * maintenance page instead of the published site. Independent of
   * the publish flow — tenants can toggle on/off without re-saving
   * settings. Keeps the published_settings intact so flipping the
   * flag back to false restores the site instantly.
   */
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  /**
   * Custom message shown on the maintenance page. Null = use the
   * default ("Halaman publik usaha kami sedang diperbarui").
   */
  maintenanceMessage: text('maintenance_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * JUR-176: append-only snapshot of each publish event. Used for the
 * "Riwayat publikasi" list + rollback ("Pulihkan" copies an old
 * snapshot back into tenant_sites.settings, doesn't auto-republish).
 *
 * We keep the last 5 rows per tenant — publishSite() trims older
 * entries in the same transaction. Older history isn't worth the
 * storage; this isn't a CMS audit log, it's an undo button.
 */
export const sitePublishHistory = pgTable(
  'site_publish_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    templateId: text('template_id').notNull(),
    settings: jsonb('settings').notNull(),
    publishedAt: timestamp('published_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantPublishedIdx: index('site_publish_history_tenant_published_idx').on(
      t.tenantId,
      t.publishedAt,
    ),
  }),
)

/**
 * Per-branch public site, used when `tenants.situs_mode = 'per_branch'`.
 *
 * Deliberately a separate table from `tenant_sites` rather than adding
 * a `branch_id` to it: `tenant_sites` is keyed by `tenant_id` PK and
 * its publish/draft flow assumes exactly one row per tenant. In
 * `single` mode that single tenant-wide site is still the whole story
 * (its booking widget just gains an outlet picker). `per_branch` mode
 * is the genuinely different shape — one row per outlet — so it gets
 * its own table and leaves the single-mode code path untouched.
 *
 * Column structure mirrors `tenant_sites` (same draft/published split,
 * maintenance toggle). `slug` is the per-branch public slug, nullable
 * until claimed (partial unique index, same pattern as
 * `tenants.public_slug`).
 */
export const branchSites = pgTable(
  'branch_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    /** Per-branch public slug. Null until the branch claims one. */
    slug: text('slug'),
    templateId: text('template_id').notNull(),
    settings: jsonb('settings').notNull().default({}),
    publishedTemplateId: text('published_template_id'),
    publishedSettings: jsonb('published_settings'),
    publishedAt: timestamp('published_at'),
    maintenanceMode: boolean('maintenance_mode').notNull().default(false),
    maintenanceMessage: text('maintenance_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    // One site per branch.
    branchUnique: uniqueIndex('branch_sites_branch_unique').on(t.branchId),
    // Slug uniqueness only across claimed (non-null) slugs.
    slugUnique: uniqueIndex('branch_sites_slug_unique')
      .on(t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
    tenantIdx: index('branch_sites_tenant_idx').on(t.tenantId),
  }),
)
