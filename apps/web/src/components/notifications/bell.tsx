import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import {
  getUnreadCount,
  getRecentNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/server/functions/notifications'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

const POLL_MS = 30_000

export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => getUnreadCount(),
    refetchInterval: POLL_MS,
  })

  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => getRecentNotifications({ data: { limit: 5 } }),
    enabled: open,
  })

  // Click-outside to close. Captures clicks on the document and
  // closes when the click is neither on the popover nor the button
  // (which has its own toggle handler).
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function handleMarkAll() {
    await markAllNotificationsRead()
    await queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  async function handleClickRow(row: { id: string; readAt: Date | null; url: string | null }) {
    setOpen(false)
    if (!row.readAt) {
      await markNotificationRead({ data: { id: row.id } })
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
    if (row.url) {
      navigate({ to: row.url })
    } else {
      navigate({ to: '/notifications' })
    }
  }

  const count = unread?.count ?? 0
  const dateLocale = i18n.language === 'en' ? undefined : idLocale

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notifications.title')}
        className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-2 w-80 origin-top-right rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {t('notifications.title')}
            </p>
            {count > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {recentLoading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('common.loading')}
              </p>
            ) : !recent || recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('notifications.empty')}
              </p>
            ) : (
              <ul>
                {recent.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClickRow(n)}
                      className={cn(
                        'flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-700/60 dark:hover:bg-gray-700/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          n.readAt
                            ? 'bg-transparent'
                            : 'bg-brand-500',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {n.title}
                        </p>
                        <p className="line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
                          {n.body}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                          {formatDistanceToNow(new Date(n.createdAt), {
                            addSuffix: true,
                            locale: dateLocale,
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-200 px-4 py-2 dark:border-gray-700">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('notifications.viewAll')}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
