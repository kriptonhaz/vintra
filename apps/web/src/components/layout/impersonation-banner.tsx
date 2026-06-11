import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, X } from 'lucide-react'
import { useEndImpersonation } from '@/hooks/use-impersonation'

interface ImpersonationBannerProps {
  tenantName: string
}

export function ImpersonationBanner({ tenantName }: ImpersonationBannerProps) {
  const { t } = useTranslation()
  const endMut = useEndImpersonation()
  const navigate = useNavigate()

  async function handleExit() {
    await endMut.mutateAsync()
    navigate({ to: '/admin/tenants' })
  }

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-warning-300 bg-warning-100 px-4 py-2 text-sm text-warning-900 shadow-sm dark:border-warning-700 dark:bg-warning-900/40 dark:text-warning-100 sm:px-6">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-semibold">
          {t('admin.impersonation.modePrefix')}
        </span>{' '}
        <span className="truncate">{tenantName}</span>
      </p>
      <button
        type="button"
        onClick={handleExit}
        disabled={endMut.isPending}
        className="inline-flex items-center gap-1 rounded-md bg-warning-200 px-2.5 py-1 text-xs font-medium text-warning-900 transition-colors hover:bg-warning-300 disabled:opacity-50 dark:bg-warning-800 dark:text-warning-100 dark:hover:bg-warning-700"
      >
        <X className="h-3 w-3" />
        {t('admin.impersonation.exit')}
      </button>
    </div>
  )
}
