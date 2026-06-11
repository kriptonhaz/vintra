import { useState } from 'react'
import {
  createFileRoute,
  Link,
  useRouter,
  useNavigate,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Send, PackageCheck, XCircle } from 'lucide-react'
import {
  getPurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
} from '@/server/functions/inventory-po'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { ReceivePoSheet } from '@/components/inventory/receive-po-sheet'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate, formatNumberID } from '@/lib/utils' // JUR-137

export const Route = createFileRoute('/_authed/inventory/po/$poId')({
  loader: ({ params }) => getPurchaseOrder({ data: { id: params.poId } }),
  component: PoDetailPage,
})

function PoDetailPage() {
  const po = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [sendOpen, setSendOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Status drives every action button. Doing the gating here so the
  // JSX stays clean and we never fire a server fn that the backend
  // would reject (the backend re-checks too — defence in depth).
  const canSend = po.status === 'draft'
  const canReceive = po.status === 'sent' || po.status === 'partial'
  const canCancel =
    po.status === 'draft' ||
    po.status === 'sent' ||
    po.status === 'partial'

  async function handleSend() {
    setBusy(true)
    try {
      await sendPurchaseOrder({ data: { id: po.id } })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('inventory.poSentToast'),
        variant: 'success',
      })
      setSendOpen(false)
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    setBusy(true)
    try {
      await cancelPurchaseOrder({ data: { id: po.id } })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('inventory.poCancelledToast'),
        variant: 'success',
      })
      setCancelOpen(false)
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <Link
        to="/inventory/po"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('inventory.poBackToList')}
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-sm text-gray-500 dark:text-gray-400">
              {po.poNumber}
            </p>
            <h1 className="mt-0.5 text-xl font-bold text-gray-900 dark:text-gray-100">
              {po.supplierName}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {po.branchName} ·{' '}
              {formatDate(po.createdAt, 'dd MMMM yyyy')}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex h-fit items-center rounded-full px-3 py-1 text-xs font-medium',
              statusColor(po.status),
            )}
          >
            {t(`inventory.poStatus_${po.status}`)}
          </span>
        </div>

        {/* Action bar — only the buttons valid for this status render. */}
        {(canSend || canReceive || canCancel) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
            {canSend && (
              <Button variant="brand" onClick={() => setSendOpen(true)}>
                <Send className="mr-1 h-4 w-4" />
                {t('inventory.poActionSend')}
              </Button>
            )}
            {canReceive && (
              <Button variant="brand" onClick={() => setReceiveOpen(true)}>
                <PackageCheck className="mr-1 h-4 w-4" />
                {t('inventory.poActionReceive')}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                onClick={() => setCancelOpen(true)}
                className="text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-900/20"
              >
                <XCircle className="mr-1 h-4 w-4" />
                {t('inventory.poActionCancel')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* PO meta strip — expected vs received dates, total. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetaCard
          label={t('inventory.poMetaExpected')}
          value={
            po.expectedAt ? formatDate(po.expectedAt, 'dd MMM yyyy') : '—'
          }
        />
        <MetaCard
          label={t('inventory.poMetaReceived')}
          value={
            po.receivedAt ? formatDate(po.receivedAt, 'dd MMM yyyy') : '—'
          }
        />
        <MetaCard
          label={t('inventory.poTotal')}
          value={formatRupiah(po.subtotal)}
          accent
        />
      </div>

      {/* Lines table — shows ordered vs received per line so the user
          can see at a glance which lines are still pending. */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-100 px-5 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('inventory.poLines')}
          </h2>
        </div>
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {po.lines.map((line) => {
            const remaining = line.orderedQty - line.receivedQty
            const fullyReceived = remaining <= 0
            return (
              <li key={line.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {line.itemName}
                    </p>
                    {line.notes && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {line.notes}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-gray-600 dark:text-gray-400">
                        {t('inventory.poLineOrdered')}:{' '}
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {formatNumberID(line.orderedQty)}{' '}
                          {line.unitLabel}
                        </span>
                      </span>
                      <span
                        className={cn(
                          fullyReceived
                            ? 'text-success-700 dark:text-success-400'
                            : 'text-warning-700 dark:text-warning-400',
                        )}
                      >
                        {t('inventory.poLineReceived')}:{' '}
                        <span className="font-semibold">
                          {formatNumberID(line.receivedQty)}{' '}
                          {line.unitLabel}
                        </span>
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        @{formatRupiah(line.unitCost)}
                      </span>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {formatRupiah(line.subtotal)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {po.notes && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('inventory.poFieldNotes')}
          </p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {po.notes}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        onConfirm={handleSend}
        title={t('inventory.poConfirmSendTitle')}
        description={t('inventory.poConfirmSendDesc', { poNumber: po.poNumber })}
        confirmText={t('inventory.poActionSend')}
        cancelText={t('common.cancel')}
        loading={busy}
      />

      <ConfirmDialog
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onConfirm={handleCancel}
        title={t('inventory.poConfirmCancelTitle')}
        description={t('inventory.poConfirmCancelDesc', { poNumber: po.poNumber })}
        confirmText={t('inventory.poActionCancel')}
        cancelText={t('common.cancel')}
        variant="danger"
        loading={busy}
      />

      <ReceivePoSheet
        open={receiveOpen}
        po={po}
        onClose={() => setReceiveOpen(false)}
        onReceived={async (allReceived) => {
          setReceiveOpen(false)
          toast({
            title: t('common.toastSavedTitle'),
            description: allReceived
              ? t('inventory.poFullyReceivedToast')
              : t('inventory.poPartialReceivedToast'),
            variant: 'success',
          })
          await router.invalidate()
        }}
      />
    </div>
  )
}

function MetaCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        accent
          ? 'border-brand-300 bg-brand-50 dark:border-brand-900/40 dark:bg-brand-900/10'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-base font-semibold',
          accent
            ? 'text-brand-700 dark:text-brand-300'
            : 'text-gray-900 dark:text-gray-100',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function statusColor(s: string) {
  return (
    {
      draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
      sent: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
      partial: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
      received:
        'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
      cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }[s] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
  )
}
