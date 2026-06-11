/**
 * Per-tenant sitemap.xml (JUR-188). A published tenant subdomain gets
 * a one-URL sitemap (the homepage); anything else 404s — there's
 * nothing to index for a draft / maintenance / unclaimed subdomain or
 * the apex.
 *
 * Server-only route — no `component`, just a GET handler.
 */
import { createFileRoute } from '@tanstack/react-router'
import { resolvePublicSiteStatus } from '@/server/lib/public-site-status'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const status = await resolvePublicSiteStatus(
          request.headers.get('host'),
        )

        if (status.kind !== 'published') {
          return new Response('Not found', { status: 404 })
        }

        const loc = `https://${status.slug}.vintra.my.id/`
        const lastmod = status.publishedAt.toISOString()
        const xml =
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          '  <url>\n' +
          `    <loc>${loc}</loc>\n` +
          `    <lastmod>${lastmod}</lastmod>\n` +
          '  </url>\n' +
          '</urlset>\n'

        return new Response(xml, {
          headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, s-maxage=300',
          },
        })
      },
    },
  },
})
