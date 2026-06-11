/**
 * Best-effort Cloudflare cache purge for a tenant's public subdomain
 * (JUR-177). Public tenant pages carry `Cache-Control: s-maxage=300`
 * so Cloudflare edge-caches them for 5 minutes; purging on publish /
 * maintenance toggle makes the change visible immediately instead of
 * waiting out that TTL.
 *
 * Hard rule: this must NEVER break a publish. It no-ops (logged) when
 * the env isn't configured or the tenant has no slug, and swallows
 * every network/API error.
 */

/**
 * Purge the cached HTML + robots/sitemap for one tenant subdomain.
 * Pass the tenant's `publicSlug`; a null slug (unclaimed) is a no-op.
 */
export async function purgeTenantSiteCache(slug: string | null): Promise<void> {
  if (!slug) return

  const token = process.env['CLOUDFLARE_API_TOKEN']
  const zoneId = process.env['CLOUDFLARE_ZONE_ID']
  if (!token || !zoneId) {
    console.warn(
      `[cf-purge] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set — skipping purge for "${slug}"`,
    )
    return
  }

  const base = `https://${slug}.vintra.my.id`
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          files: [`${base}/`, `${base}/robots.txt`, `${base}/sitemap.xml`],
        }),
      },
    )
    if (!res.ok) {
      console.warn(
        `[cf-purge] purge failed for "${slug}" — HTTP ${res.status}`,
      )
    }
  } catch (err) {
    console.warn(`[cf-purge] purge error for "${slug}":`, err)
  }
}
