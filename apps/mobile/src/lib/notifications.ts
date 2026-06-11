/**
 * Notifications API hooks. Drives:
 *   - the bell badge on the home screen (unread count)
 *   - the /notifications screen (full list, mark-read)
 *
 * Server fns exposed via the mobile gateway:
 *   listNotifications, getRecentNotifications, getUnreadCount,
 *   markNotificationRead, markAllNotificationsRead
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface Notification {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  data: Record<string, unknown> | null
  sourceKey: string | null
  readAt: string | null
  createdAt: string
}

interface ListResponse {
  items: Notification[]
  total: number
  unreadCount: number
  page: number
  pageSize: number
}

export function useNotifications(page = 1, pageSize = 20) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['notifications', 'list', tenantId, page, pageSize],
    queryFn: () =>
      callServerFn<ListResponse>('listNotifications', { page, pageSize }),
    enabled: !!tenantId,
  })
}

/**
 * Infinite-scroll variant of `useNotifications`. Loads the first page
 * on mount, then `fetchNextPage()` (driven by FlatList's onEndReached)
 * pulls the next 20-row chunk. Stops when `page * pageSize >= total`.
 */
export function useInfiniteNotifications(pageSize = 20) {
  const { tenantId } = useTenant()
  return useInfiniteQuery<ListResponse>({
    queryKey: ['notifications', 'list-infinite', tenantId, pageSize],
    enabled: !!tenantId,
    initialPageParam: 1,
    queryFn: ({ pageParam = 1 }) =>
      callServerFn<ListResponse>('listNotifications', {
        page: pageParam,
        pageSize,
      }),
    getNextPageParam: (last) => {
      const consumed = last.page * last.pageSize
      return consumed < last.total ? last.page + 1 : undefined
    },
  })
}

/** Tiny payload for the bell badge — no body, no list, just a number. */
export function useUnreadCount() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['notifications', 'unread', tenantId],
    queryFn: () => callServerFn<{ count: number }>('getUnreadCount'),
    enabled: !!tenantId,
    // Re-poll every minute so the badge feels live without push.
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ ok: true }>('markNotificationRead', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callServerFn<{ ok: true }>('markAllNotificationsRead'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
