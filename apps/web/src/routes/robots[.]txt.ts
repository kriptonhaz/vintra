/**
 * Per-tenant robots.txt (JUR-188). Served dynamically because the
 * directive depends on the subdomain: a published tenant site is
 * crawlable + advertises its sitemap; a draft / maintenance / unclaimed
 * subdomain is fully disallowed so half-built sites never get indexed.
 *
 * Server-only route — no `component`, just a GET handler.
 */
import { createFileRoute } from '@tanstack/react-router'
import { resolvePublicSiteStatus } from '@/server/lib/public-site-status'

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const status = await resolvePublicSiteStatus(
          request.headers.get('host'),
        )

        let body: string
        if (status.kind === 'published') {
          body =
            'User-agent: *\n' +
            'Allow: /\n' +
            `Sitemap: https://${status.slug}.vintra.my.id/sitemap.xml\n`
        } else if (status.kind === 'apex') {
          // The vintra.my.id marketing site — crawlable.
          body = 'User-agent: *\nAllow: /\n'
        } else {
          // Draft / maintenance / unclaimed subdomain — keep it out
          // of every index.
          body = 'User-agent: *\nDisallow: /\n'
        }

        return new Response(body, {
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            // Short edge cache — robots flips the moment a tenant
            // publishes; the publish purge clears it anyway.
            'cache-control': 'public, s-maxage=300',
          },
        })
      },
    },
  },
})
