/**
 * JUR-185: path-based direct access to the public queue page at
 * `/q/<slug>`. Subdomain access (`<slug>.vintra.my.id/`) is handled
 * by the index route — see `routes/index.tsx`. Both call into the
 * same `PublicQueuePage` component.
 *
 * Kept as a separate route for two reasons:
 *   1. Backwards-compat with any links generated before the index
 *      route went Host-aware.
 *   2. Useful for testing without DNS gymnastics during development.
 *
 * JUR-189 (#199): the loader catches downstream failures (Supabase
 * blip, asset signing) and returns a `kind: 'error'` sentinel so the
 * component can render the branded `PublicSiteError` page — same
 * contract the index route uses — instead of throwing a raw 500.
 */
import { createFileRoute, notFound } from '@tanstack/react-router'
import { getPublicQueueData } from '@/server/functions/public-tenant'
import {
  PublicSitePage,
  PublicQueueNotFound,
} from '@/components/public-site-page'
import { PublicSiteError } from '@/components/public-site-error'

type QueueLoaderData =
  | { kind: 'queue'; data: NonNullable<Awaited<ReturnType<typeof getPublicQueueData>>> }
  | { kind: 'error' }

export const Route = createFileRoute('/q/$slug')({
  loader: async ({ params }): Promise<QueueLoaderData> => {
    // `track: true` — this is the SSR initial-load path. The 15s
    // polling client in PublicSitePage omits the flag so it doesn't
    // inflate the visit counter.
    let data: Awaited<ReturnType<typeof getPublicQueueData>>
    try {
      data = await getPublicQueueData({
        data: { slug: params.slug, track: true },
      })
    } catch (err) {
      console.error(
        `[public-queue] data fetch failed for "${params.slug}":`,
        err,
      )
      return { kind: 'error' }
    }
    if (!data) throw notFound()
    return { kind: 'queue', data }
  },
  head: ({ loaderData }) => {
    if (loaderData?.kind === 'error') {
      return { meta: [{ name: 'robots', content: 'noindex,nofollow' }] }
    }
    const queue = loaderData?.kind === 'queue' ? loaderData.data : null
    const meta = [
      {
        title: queue
          ? `${queue.tenant.businessName} — Antrian Live`
          : 'Halaman tidak ditemukan',
      },
    ]
    // Preload the first hero image so the LCP fetch starts before
    // body parse discovers the <img>. Mirrors the head() in
    // routes/index.tsx (subdomain path) — see public-site-seo.ts.
    const heroUrl = queue?.seo?.firstHeroImageUrl ?? null
    if (heroUrl) {
      return {
        meta,
        links: [
          {
            rel: 'preload',
            as: 'image',
            href: heroUrl,
            fetchPriority: 'high',
          },
        ],
      }
    }
    return { meta }
  },
  component: QueueRouteComponent,
  notFoundComponent: PublicQueueNotFound,
})

function QueueRouteComponent() {
  const params = Route.useParams()
  const loaderData = Route.useLoaderData()
  if (loaderData.kind === 'error') return <PublicSiteError />
  return <PublicSitePage slug={params.slug} initial={loaderData.data} />
}
