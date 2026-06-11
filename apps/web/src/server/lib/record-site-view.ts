/**
 * Server-only helpers for recording tenant site views.
 *
 * Kept in `server/lib/` so the client bundle never imports them.
 * The createServerFn macro strips handler bodies but not top-level
 * module imports, so anything that needs `db` / `crypto` lives here
 * to avoid leaking those into the client.
 */
import { createHash } from 'crypto'
import { db } from '@vintra/db'
import { tenantSiteViews } from '@vintra/db/schema'

export async function recordSiteView(args: {
  tenantId: string
  slug: string
  path: string
  ip: string | null
  referrer: string | null
}): Promise<void> {
  try {
    const jakartaDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Jakarta',
    })
    const ipForHash = args.ip ?? 'no-ip'
    const visitorHash = createHash('sha256')
      .update(`${ipForHash}|${jakartaDate}|${args.slug}`)
      .digest('hex')

    await db.insert(tenantSiteViews).values({
      tenantId: args.tenantId,
      visitorHash,
      path: args.path.slice(0, 200),
      referrer: args.referrer ? args.referrer.slice(0, 500) : null,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[recordSiteView] insert failed:', err)
  }
}

/**
 * Picks the most-trustworthy client IP header set by our edge stack.
 *   1. `cf-connecting-ip` — set by Cloudflare, immune to spoofing
 *   2. `x-real-ip` — set by nginx
 *   3. `x-forwarded-for` first hop — fallback
 *
 * Returns `null` if none are present.
 */
export function getClientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')
  if (cf) return cf
  const real = headers.get('x-real-ip')
  if (real) return real
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return null
}
