import { useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Bell, BellOff, Trash2 } from 'lucide-react'
import {
  listNotifications,
  markAllNotificationsRead,
  deleteNotification,
} from '@/server/functions/notifications'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { usePushSubscription } from '@/hooks/use-push-subscription'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

const PAGE_SIZE = 20

const searchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
})

export const Route = createFileRoute('/_authed/notifications')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }) =>
    listNotifications({ data: { page: deps.page, pageSize: PAGE_SIZE } }),
  component: NotificationsPage,
})

function NotificationsPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Mark everything read on open. The /notifications page IS the inbox —
  // arriving here means the user has seen the items.
  useEffect(() => {
    if (data.unreadCount > 0) {
      void markAllNotificationsRead().then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      })
    }
    // intentionally omit data.unreadCount from deps — we only mark on
    // initial mount per page navigation, not on cache refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.page])

  const dateLocale = i18n.language === 'en' ? undefined : idLocale
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const start = (search.page - 1) * PAGE_SIZE + 1
  const end = Math.min(data.total, search.page * PAGE_SIZE)

  async function handleDelete(id: string) {
    await deleteNotification({ data: { id } })
    await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    // Re-run the route loader to refresh the visible list.
    await navigate({ to: '/notifications', search: { page: search.page } })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('notifications.pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('notifications.pageSubtitle')}
        </p>
      </div>

      <PushStatusBanner />

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <Bell className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">
            {t('notifications.empty')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.items.map((n) => (
              <li
                key={n.id}
                className="flex gap-3 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    n.readAt ? 'bg-transparent' : 'bg-brand-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  {n.url ? (
                    <Link
                      to={n.url}
                      className="font-medium text-gray-900 hover:underline dark:text-gray-100"
                    >
                      {n.title}
                    </Link>
                  ) : (
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {n.title}
                    </p>
                  )}
                  <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                    {n.body}
                  </p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {formatDistanceToNow(new Date(n.createdAt), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(n.id)}
                  aria-label={t('notifications.dismiss')}
                  className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-danger-600 dark:hover:bg-gray-700"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <p>
            {t('notifications.showing', {
              start,
              end,
              total: data.total,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={search.page <= 1}
              onClick={() =>
                navigate({
                  to: '/notifications',
                  search: { page: search.page - 1 },
                })
              }
            >
              {t('common.prev')}
            </Button>
            <Button
              variant="ghost"
              disabled={search.page >= totalPages}
              onClick={() =>
                navigate({
                  to: '/notifications',
                  search: { page: search.page + 1 },
                })
              }
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Browser-push status banner. Sits above the notifications list and
 * surfaces actionable copy per state:
 *
 *   - subscribed                → nothing (the happy path is silent)
 *   - unsubscribed (default)    → "Aktifkan untuk dapat notifikasi" + Aktifkan button
 *   - denied                    → "Notifikasi diblokir" + Coba Aktifkan + Cara aktifkan link
 *   - unsupported               → quiet info note
 *
 * "Coba Aktifkan" on a denied state will fire requestPermission(),
 * which most browsers immediately resolve to 'denied' without showing
 * a UI prompt — but it costs nothing to try, and on the slim chance
 * the user reset the permission elsewhere, it'll work. Either way the
 * help text below explains how to fix it via browser settings.
 */
function PushStatusBanner() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { state, ready, busy, enable, resetDismissPrompt } =
    usePushSubscription()

  if (!ready) return null
  if (state === 'subscribed') return null

  async function handleEnable() {
    // If they previously clicked "Nanti" on a prompt elsewhere,
    // explicitly re-engaging here should clear that flag.
    resetDismissPrompt()
    const res = await enable()
    if (res.ok) {
      toast({ title: t('account.pushEnabledToast'), variant: 'success' })
      return
    }
    // Always surface failures — denied gets the actionable hint;
    // other failures show whatever message the hook returned so the
    // user (and we) can see what actually broke.
    toast({
      title:
        res.reason === 'denied'
          ? t('account.pushDenied')
          : t('common.toastFailedTitle'),
      description:
        res.reason === 'denied'
          ? t('account.pushDeniedHint')
          : (res.message ?? 'Gagal mengaktifkan notifikasi'),
      variant: 'error',
    })
  }

  if (state === 'unsupported') {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        <BellOff className="mr-2 inline h-4 w-4" />
        {t('account.pushNotSupported')}
      </div>
    )
  }

  if (state === 'requires-pwa') {
    // iOS Safari in a regular tab — push only becomes available
    // after the user adds the site to the Home Screen and opens it
    // from there. Show the install steps explicitly.
    return (
      <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-900/40 dark:bg-primary-900/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-primary-900 dark:text-primary-200">
              {t('account.pushIosTitle')}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-primary-800 dark:text-primary-300">
              <li>{t('account.pushIosStep1')}</li>
              <li>{t('account.pushIosStep2')}</li>
              <li>{t('account.pushIosStep3')}</li>
            </ol>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-900/40 dark:bg-warning-900/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-400" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-warning-900 dark:text-warning-200">
              {t('notifications.pushBlockedTitle')}
            </p>
            <p className="mt-1 text-sm text-warning-800 dark:text-warning-300">
              {t('notifications.pushBlockedBody')}
            </p>
          </div>
          <Button
            variant="outline"
            loading={busy}
            onClick={handleEnable}
            className="shrink-0"
          >
            {t('notifications.pushTryEnable')}
          </Button>
        </div>
      </div>
    )
  }

  // unsubscribed
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-900/40 dark:bg-brand-900/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {t('notifications.pushOffTitle')}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('notifications.pushOffBody')}
          </p>
        </div>
        <Button
          variant="brand"
          loading={busy}
          onClick={handleEnable}
          className="shrink-0"
        >
          {t('notifications.pushEnableNow')}
        </Button>
      </div>
    </div>
  )
}
