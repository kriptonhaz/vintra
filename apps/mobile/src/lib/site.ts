/**
 * Site (microsite) hooks. Mobile only exposes the lightweight admin
 * surfaces — slug, maintenance toggle, publish, analytics. The
 * heavyweight visual section editor remains web-only.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface SiteSettingsResponse {
  /** Full settings JSON tree (sections etc). Mobile renders only a
   *  summary — we don't introspect this. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any
  assetUrls: Record<string, string>
  published: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: any
    publishedAt: string
  } | null
  maintenance: {
    mode: boolean
    message: string | null
  }
}

export function useMySiteSettings() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['site', 'settings', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<SiteSettingsResponse>(
        'getMySiteSettings',
        {},
        { tenantId },
      ),
  })
}

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['site'] })
}

export function usePublishSite() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callServerFn<{ publishedAt: string }>(
        'publishSite',
        {},
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export function useSetSiteMaintenanceMode() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { mode: boolean; message?: string | null }) =>
      callServerFn<{ success: true }>(
        'setSiteMaintenanceMode',
        input,
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export interface PublishHistoryEntry {
  id: string
  templateId: string | null
  publishedAt: string
}

export function useSitePublishHistory() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['site', 'history', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<PublishHistoryEntry[]>(
        'listSitePublishHistory',
        {},
        { tenantId },
      ),
  })
}

export function useClaimPublicSlug() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) =>
      callServerFn<{ slug: string }>(
        'claimPublicSlug',
        { slug },
        { tenantId },
      ),
    onSuccess: () => inv(qc),
  })
}

export interface SiteAnalyticsSummary {
  totalViews: number
  uniqueVisitors: number
  ctaClicks: number
  perDay: Array<{ date: string; views: number; visitors: number }>
}

export function useSiteAnalyticsSummary(rangeDays: number) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['site', 'analytics', tenantId, rangeDays],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<SiteAnalyticsSummary>(
        'getSiteAnalyticsSummary',
        { rangeDays },
        { tenantId },
      ),
  })
}
