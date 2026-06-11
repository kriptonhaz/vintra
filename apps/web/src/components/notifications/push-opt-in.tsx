import { useTranslation } from 'react-i18next'
import { Bell, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { usePushSubscription } from '@/hooks/use-push-subscription'

/**
 * Always-visible toggle on /settings/account. Reads its state from the
 * shared usePushSubscription hook so the auto-prompt banner and the
 * notifications-page banner stay in sync without a global store.
 */
export function PushOptIn() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { state, busy, ready, enable, disable } = usePushSubscription()

  async function handleEnable() {
    const res = await enable()
    if (res.ok) {
      toast({ title: t('account.pushEnabledToast'), variant: 'success' })
      return
    }
    // Always surface failures so silent breakage is visible.
    toast({
      title: t('common.toastFailedTitle'),
      description:
        res.reason === 'denied'
          ? t('account.pushDenied')
          : (res.message ?? 'Gagal mengaktifkan notifikasi'),
      variant: 'error',
    })
  }

  async function handleDisable() {
    await disable()
    toast({ title: t('account.pushDisabledToast'), variant: 'success' })
  }

  if (!ready) {
    return (
      <p className="text-sm text-gray-400 dark:text-gray-500">
        {t('common.loading')}
      </p>
    )
  }

  if (state === 'unsupported') {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('account.pushNotSupported')}
      </p>
    )
  }

  if (state === 'requires-pwa') {
    // iOS Safari in a regular tab — push only becomes available
    // after the user adds the site to the Home Screen and opens it
    // from there. Show the install steps explicitly.
    return (
      <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-800 dark:border-primary-900/40 dark:bg-primary-900/20 dark:text-primary-300">
        <p className="font-medium">{t('account.pushIosTitle')}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
          <li>{t('account.pushIosStep1')}</li>
          <li>{t('account.pushIosStep2')}</li>
          <li>{t('account.pushIosStep3')}</li>
        </ol>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-300">
        <BellOff className="mb-1 inline h-4 w-4" /> {t('account.pushDenied')}
      </div>
    )
  }

  if (state === 'subscribed') {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-success-700 dark:text-success-400">
          <Bell className="mr-1 inline h-4 w-4" /> {t('account.pushActive')}
        </p>
        <Button variant="ghost" loading={busy} onClick={handleDisable}>
          {t('account.pushDisable')}
        </Button>
      </div>
    )
  }

  // unsubscribed
  return (
    <Button variant="brand" loading={busy} onClick={handleEnable}>
      <Bell className="mr-1 inline h-4 w-4" /> {t('account.pushEnable')}
    </Button>
  )
}
