import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127

export const Route = createFileRoute('/_authed/inventory/locked')({
  component: LockedPage,
})

const SALES_WHATSAPP = buildSalesWaUrl(
  'Halo Vintra, langganan Inventory saya tidak aktif. Saya ingin perpanjang.',
)

function LockedPage() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto max-w-md py-16">
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning-100 dark:bg-warning-900/30">
          <Lock className="h-6 w-6 text-warning-700 dark:text-warning-400" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {t('inventory.lockedTitle')}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t('inventory.lockedBody')}
        </p>
        <div className="mt-6 space-y-2">
          <Link to="/inventory/billing">
            <Button variant="brand" className="w-full">
              {t('inventory.lockedSeePlans')}
            </Button>
          </Link>
          <a href={SALES_WHATSAPP} target="_blank" rel="noreferrer">
            <Button variant="outline" className="w-full">
              <MessageCircle className="mr-1 h-4 w-4" />
              {t('inventory.contactSales')}
            </Button>
          </a>
        </div>
      </div>
    </div>
  )
}
