import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { tenants } from './auth'

/**
 * JUR-176 follow-up: page-view ledger for tenant public sites.
 *
 * One row per visit. Dedup is best-effort via the `visitor_hash`
 * column — a sha256 of (visitor IP + day salt + slug) so the same
 * visitor refreshing many times in a day collapses to one logical
 * "unique visitor" without us actually storing the IP.
 *
 * No GeoIP / country yet — deferred. The `referrer` field captures
 * basic acquisition channel data when the browser sends it (most
 * https-to-https hops do).
 */
export const tenantSiteViews = pgTable(
  'tenant_site_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    viewedAt: timestamp('viewed_at').notNull().defaultNow(),
    /**
     * Anonymized visitor identifier — sha256(ip + day_salt + slug).
     * Same visitor refreshing N times in a day produces N rows with
     * the same hash, so a `COUNT(DISTINCT visitor_hash)` gives a
     * meaningful "unique visitors" without storing the IP itself.
     * Day salt rotates the hash each midnight (Asia/Jakarta) so the
     * same person across multiple days appears multiple times in
     * the unique count — matches how civilians read "unique visitors".
     */
    visitorHash: text('visitor_hash').notNull(),
    /** The path that was visited — `/` on subdomain, `/q/<slug>` on apex. */
    path: text('path').notNull(),
    /** HTTP Referer header (browser-truncated when not safelist-able). */
    referrer: text('referrer'),
  },
  (t) => ({
    // Powers "last 30 days per tenant" + the unique-visitor distinct
    // query, both used by every chart on the analytics page.
    tenantViewedIdx: index('tenant_site_views_tenant_viewed_idx').on(
      t.tenantId,
      t.viewedAt,
    ),
  }),
)
