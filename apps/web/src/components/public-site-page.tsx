/**
 * Public site renderer (v2). Uses the section-builder architecture
 * from JUR-176 v2: walks `state.site.settings.sections[]` and renders
 * each section through `SECTIONS[type].Render`.
 *
 * If the tenant has no published site yet (no `tenant_sites` row),
 * falls back to the baseline queue page from JUR-185 — so the cuci
 * motor customer who published before v2 landed keeps seeing their
 * queue without interruption.
 *
 * Live polling (15s) sits here, not inside sections — that way the
 * Queue section just renders whatever's in the current data prop
 * without needing to know about cache invalidation.
 */
import { useQuery } from '@tanstack/react-query'
import { getPublicQueueData } from '@/server/functions/public-tenant'
import { PublicQueuePage, PublicQueueNotFound } from '@/components/public-queue-page'
import { SiteMaintenancePage } from '@/components/site-maintenance-page'
import { PublicSiteRenderV2 } from '@/lib/site-templates/sections-v2/render'
import { normalizeSettingsV2 } from '@/lib/site-templates/sections-v2/normalize'
import type { PublicSiteRenderData } from '@/lib/site-templates/v2-types'

type RawQueueData = NonNullable<Awaited<ReturnType<typeof getPublicQueueData>>>

export function PublicSitePage({
  slug,
  initial,
}: {
  slug: string
  initial: RawQueueData
}) {
  const { data: state = initial } = useQuery({
    queryKey: ['public-site', slug],
    queryFn: async () => {
      const next = await getPublicQueueData({ data: { slug } })
      return next ?? initial
    },
    initialData: initial,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  // Maintenance mode wins over everything — tenants who flip the
  // "Sedang dalam perbaikan" toggle want their published site
  // hidden RIGHT NOW, not after the next poll resolves. The brand
  // color is carried through from their last-published theme so
  // the page still feels like theirs.
  if (state.maintenance?.active) {
    return (
      <SiteMaintenancePage
        businessName={state.tenant.businessName}
        customMessage={state.maintenance.message}
        brandColor={state.maintenance.brandColor}
      />
    )
  }

  // No published v2 settings → fall back to JUR-185 baseline. Keeps
  // tenants on the queue-only page running until they go through the
  // v2 editor and publish at least once.
  if (!state.site?.settings) {
    return <PublicQueuePage slug={slug} initial={state} />
  }

  // Server returns settings either as a v2 shape (current path) or a
  // v1 flat-key blob (legacy). Normalizer accepts both.
  const v2 = normalizeSettingsV2(state.site.settings)
  const assetUrls = state.site.assetUrls ?? {}
  const renderData: PublicSiteRenderData = {
    tenant: state.tenant,
    mode: state.mode as PublicSiteRenderData['mode'],
    branches: state.branches,
    services: state.services,
    resources: state.resources,
    queue: state.queue,
    tax: state.tax ?? { totalPercent: 0, labels: [] },
    promos: state.promos ?? [],
    stampPrograms: state.stampPrograms ?? [],
  }

  return (
    <PublicSiteRenderV2
      settings={v2}
      data={renderData}
      resolveAssetUrl={(key) => (key ? (assetUrls[key] ?? null) : null)}
    />
  )
}

export { PublicQueueNotFound }
