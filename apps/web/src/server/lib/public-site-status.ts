/**
 * Resolve a request Host into the public-site status of the tenant
 * behind that subdomain (JUR-188). Shared by the `/robots.txt` and
 * `/sitemap.xml` server routes — both need to know "is this a
 * published tenant site, a not-yet-published one, or the apex".
 */
import { db } from '@vintra/db'
import { tenants, tenantSites } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'

/** Same subdomain shape the index route's host parser uses. */
const SUBDOMAIN_RE = /^([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\.vintra\.my\.id$/

export type PublicSiteStatus =
  | { kind: 'apex' }
  | { kind: 'published'; slug: string; publishedAt: Date }
  /** Claimed-but-draft, in maintenance, or an unclaimed subdomain. */
  | { kind: 'unlisted'; slug: string }

export async function resolvePublicSiteStatus(
  host: string | null,
): Promise<PublicSiteStatus> {
  if (!host) return { kind: 'apex' }
  const hostname = (host.split(':')[0] ?? '').toLowerCase()
  const match = hostname.match(SUBDOMAIN_RE)
  if (!match) return { kind: 'apex' }
  const slug = match[1]!
  // www / api are the apex + the API vhost — never tenant sites.
  if (slug === 'www' || slug === 'api') return { kind: 'apex' }

  const [row] = await db
    .select({
      publishedAt: tenantSites.publishedAt,
      maintenanceMode: tenantSites.maintenanceMode,
    })
    .from(tenants)
    .leftJoin(tenantSites, eq(tenantSites.tenantId, tenants.id))
    .where(eq(tenants.publicSlug, slug))
    .limit(1)

  // Indexable only when the tenant has published AND isn't in
  // maintenance — mirrors the `seo.indexable` flag on the rendered
  // page so robots.txt and the page's <meta robots> never disagree.
  if (row?.publishedAt && !row.maintenanceMode) {
    return { kind: 'published', slug, publishedAt: row.publishedAt }
  }
  return { kind: 'unlisted', slug }
}
