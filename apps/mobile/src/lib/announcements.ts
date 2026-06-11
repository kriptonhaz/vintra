/**
 * Pengumuman (announcements) — read-side hooks for the mobile app.
 * Calls the gateway fns `listAnnouncements` / `getAnnouncement`. Every
 * tenant member can read; authoring lives on the web admin (Phase 1).
 *
 * `readAt` on a list item is the caller's own read state, joined from
 * the notification that was fanned out on publish — so opening an
 * announcement (which marks that notification read) clears the unread
 * highlight here too.
 */
import { useQuery } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface AnnouncementListItem {
  id: string
  title: string
  body: string
  pinned: boolean
  publishedAt: string | null
  /** Caller's read timestamp, or null when unread. */
  readAt: string | null
}

export interface AnnouncementDetail {
  id: string
  tenantId: string
  authorUserId: string
  title: string
  body: string
  audience: string
  branchId: string | null
  pinned: boolean
  status: string
  publishedAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export function useAnnouncements(limit = 20) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['announcements', 'list', tenantId, limit],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<AnnouncementListItem[]>(
        'listAnnouncements',
        { limit },
        { tenantId },
      ),
    retry: false,
  })
}

export function useAnnouncement(id: string) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['announcements', 'detail', tenantId, id],
    enabled: !!tenantId && !!id,
    queryFn: () =>
      callServerFn<AnnouncementDetail>('getAnnouncement', { id }, { tenantId }),
    retry: false,
  })
}
