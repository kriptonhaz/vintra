/**
 * Routes a notification's `url` field (which is always shaped for the
 * web dashboard) to either an in-app mobile route or an external web
 * URL on the tenant subdomain.
 *
 * Why this exists: server emitters write a single `url` for the bell
 * across web + mobile. Mobile has its own route table — a few cores
 * (inventory tab, item detail, absensi tab) map cleanly, the rest fall
 * back to the web (billing pages, z-report, admin tools, etc.). Using a
 * single resolver keeps the dispatch logic out of every emitter and
 * avoids the "Unmatched Route" black-screen the user sees when we just
 * `router.push(url)` blindly.
 *
 * Adding a new notification URL → first check whether the destination
 * has a mobile screen. If yes, add a mapping below. If no, do nothing —
 * the catch-all opens it on the tenant subdomain.
 */

export type ResolvedRoute =
  | { kind: 'mobile'; target: string }
  | { kind: 'web'; target: string }
  | { kind: 'none' }

/**
 * `url` is the raw value stored on the notification row. `slug` is the
 * current tenant's subdomain (or null if we haven't loaded a tenant yet
 * — we still try to open the apex domain so the user lands somewhere
 * sensible instead of getting stuck).
 */
export function resolveNotificationUrl(
  url: string | null | undefined,
  slug: string | null,
): ResolvedRoute {
  if (!url) return { kind: 'none' }

  // Absolute URL (http(s)://...) — pass through to the OS browser.
  if (!url.startsWith('/')) return { kind: 'web', target: url }

  // Split path + query so we can branch on both.
  const [path, query = ''] = url.split('?', 2)
  const params = new URLSearchParams(query)
  const webBase = slug
    ? `https://${slug}.vintra.my.id`
    : 'https://vintra.my.id'
  const webFallback = `${webBase}${url}`

  // ── Inventory ───────────────────────────────────────────────────
  if (path === '/inventory') {
    return { kind: 'mobile', target: '/(tabs)/inventory' }
  }
  if (path === '/inventory/items') {
    // /inventory/items?lowStock=1 — low-stock filter alert. Forward
    // the flag so the tab boots with the filter chip already on.
    if (params.get('lowStock') === '1') {
      return { kind: 'mobile', target: '/(tabs)/inventory?lowStock=1' }
    }
    // /inventory/items?applyHpp=... — Apply-HPP banner. Mobile doesn't
    // have that flow yet → fall back to web.
    return { kind: 'web', target: webFallback }
  }
  // /inventory/items/<id> — direct item detail. Mobile route is
  // /inventory/<id> (no /items segment).
  const invItemMatch = path.match(/^\/inventory\/items\/([^/]+)$/)
  if (invItemMatch) {
    return { kind: 'mobile', target: `/inventory/${invItemMatch[1]}` }
  }
  // /inventory/requisitions, /inventory/requisitions/<id> — mobile has
  // these screens.
  if (path === '/inventory/requisitions') {
    return { kind: 'mobile', target: '/inventory/requisitions' }
  }
  const reqMatch = path.match(/^\/inventory\/requisitions\/([^/]+)$/)
  if (reqMatch) {
    return { kind: 'mobile', target: `/inventory/requisitions/${reqMatch[1]}` }
  }

  // ── Attendance ──────────────────────────────────────────────────
  if (path === '/attendance' || path === '/attendance/check-in') {
    return { kind: 'mobile', target: '/(tabs)/absensi' }
  }
  if (path === '/attendance/history') {
    return { kind: 'mobile', target: '/attendance/history' }
  }

  // ── POS ─────────────────────────────────────────────────────────
  if (path === '/pos' || path === '/pos/cashier') {
    return { kind: 'mobile', target: '/(tabs)/pos' }
  }
  // /pos/sales?date=YYYY-MM-DD — daily Z-Report. Mobile mirrors the
  // route name so the param survives the deep link.
  if (path === '/pos/sales') {
    const date = params.get('date')
    return {
      kind: 'mobile',
      target: date ? `/pos/sales?date=${encodeURIComponent(date)}` : '/pos/sales',
    }
  }

  // ── Feedback / Help threads ────────────────────────────────────
  // /help/feedback → list; /help/feedback/<id> → thread detail. The
  // admin-side /admin/feedback URL belongs to platform admins (not
  // tenants) and is still served by the web — fall through to webBase.
  if (path === '/help/feedback') {
    return { kind: 'mobile', target: '/feedback' }
  }
  const fbMatch = path.match(/^\/help\/feedback\/([^/]+)$/)
  if (fbMatch) {
    return { kind: 'mobile', target: `/feedback/${fbMatch[1]}` }
  }

  // ── Announcements ───────────────────────────────────────────────
  if (path === '/announcements' || path === '/settings/announcements') {
    return { kind: 'mobile', target: '/announcements' }
  }
  const annMatch = path.match(/^\/announcements\/([^/]+)$/)
  if (annMatch) {
    return { kind: 'mobile', target: `/announcements/${annMatch[1]}` }
  }

  // ── Tenant picker ───────────────────────────────────────────────
  if (path === '/tenant-picker') {
    return { kind: 'mobile', target: '/tenant-picker' }
  }

  // Everything else (billing, z-report, cashflow/cicilan, admin/*,
  // help/feedback/*, etc.) — open on the tenant subdomain.
  return { kind: 'web', target: webFallback }
}
