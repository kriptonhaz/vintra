import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  adminListClaimRequests,
  adminGetClaimRequest,
  adminMarkClaimPaid,
  adminRejectClaim,
} from '@/server/functions/referral-admin'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'
import { Copy } from 'lucide-react'

export const Route = createFileRoute('/admin/referrals/claims')({
  loader: () => adminListClaimRequests(),
  component: AdminClaimsPage,
})

type ListRow = Awaited<ReturnType<typeof adminListClaimRequests>>[number]

type StatusFilter = 'all' | 'submitted' | 'paid' | 'rejected'

const STATUS_CLASSES: Record<string, string> = {
  submitted: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  approved: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
  paid: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

function AdminClaimsPage() {
  const { t } = useTranslation()
  const initial = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data: rows = initial } = useQuery({
    queryKey: ['admin', 'referral-claims', statusFilter],
    queryFn: () =>
      adminListClaimRequests({
        data: statusFilter === 'all' ? undefined : { status: statusFilter, limit: 50 },
      }),
    initialData: statusFilter === 'all' ? initial : undefined,
    staleTime: 30_000,
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'referral-claims'] })
    await router.invalidate()
  }

  function statusLabel(key: string): string {
    return t(`admin.referralClaims.status.${key}`, { defaultValue: key })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.referralClaims.title')}</CardTitle>
          <CardDescription>{t('admin.referralClaims.subtitle')}</CardDescription>
        </CardHeader>
      </Card>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'submitted', 'paid', 'rejected'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={
              'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
              (statusFilter === s
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300')
            }
          >
            {s === 'all' ? t('admin.referralClaims.filter.all') : statusLabel(s)}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="px-0 py-0">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('admin.referralClaims.emptyTpl', {
                withStatus:
                  statusFilter !== 'all'
                    ? t('admin.referralClaims.emptyStatusTpl', {
                        status: statusLabel(statusFilter),
                      })
                    : '',
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.referralClaims.col.date')}</TableHead>
                  <TableHead>{t('admin.referralClaims.col.tenant')}</TableHead>
                  <TableHead>{t('admin.referralClaims.col.bank')}</TableHead>
                  <TableHead>{t('admin.referralClaims.col.status')}</TableHead>
                  <TableHead className="text-right">
                    {t('admin.referralClaims.col.amount')}
                  </TableHead>
                  <TableHead className="w-20 text-right">
                    {t('admin.referralClaims.col.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r: ListRow) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(r.submittedAt, 'dd MMM yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.tenantName ?? '—'}</div>
                      {r.tenantSlug && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {r.tenantSlug}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      {r.bankName ? (
                        <>
                          <div>{r.bankName}</div>
                          <div className="font-mono text-xs">{r.accountNumber}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-xs font-medium ' +
                          (STATUS_CLASSES[r.status] ?? STATUS_CLASSES.submitted!)
                        }
                      >
                        {statusLabel(r.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatRupiah(parseFloat(r.totalAmountIdr))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>
                        {t('admin.referralClaims.process')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openId && (
        <ClaimDetailSheet
          id={openId}
          onClose={() => setOpenId(null)}
          onProcessed={async () => {
            setOpenId(null)
            await refresh()
            toast({ title: t('admin.referralClaims.updatedToast'), variant: 'success' })
          }}
        />
      )}
    </div>
  )
}

function ClaimDetailSheet({
  id,
  onClose,
  onProcessed,
}: {
  id: string
  onClose: () => void
  onProcessed: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'referral-claim', id],
    queryFn: () => adminGetClaimRequest({ data: { id } }),
    staleTime: 10_000,
  })

  const [notes, setNotes] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [paying, setPaying] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [confirmPayOpen, setConfirmPayOpen] = useState(false)
  const [showRejectInput, setShowRejectInput] = useState(false)

  async function handleMarkPaid() {
    setPaying(true)
    try {
      await adminMarkClaimPaid({ data: { id, adminNotes: notes || undefined } })
      await onProcessed()
    } catch (err) {
      toast({
        title: t('admin.referralClaims.detail.errorMarkPaid'),
        description: (err as Error).message,
        variant: 'error',
      })
    } finally {
      setPaying(false)
      setConfirmPayOpen(false)
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      toast({
        title: t('admin.referralClaims.detail.errorRejectReasonRequired'),
        variant: 'error',
      })
      return
    }
    setRejecting(true)
    try {
      await adminRejectClaim({ data: { id, adminNotes: rejectReason.trim() } })
      await onProcessed()
    } catch (err) {
      toast({
        title: t('admin.referralClaims.detail.errorReject'),
        description: (err as Error).message,
        variant: 'error',
      })
    } finally {
      setRejecting(false)
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: t('admin.referralClaims.detail.copyToastTpl', { label }),
        variant: 'success',
      })
    } catch {
      toast({ title: t('admin.referralClaims.detail.copyError'), variant: 'error' })
    }
  }

  const request = data?.request
  const commissions = data?.commissions ?? []
  const isClosed = request?.status === 'paid' || request?.status === 'rejected'

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('admin.referralClaims.detail.title')}</SheetTitle>
        <SheetDescription>
          {request
            ? t('admin.referralClaims.detail.fromTpl', {
                tenant: request.tenantName ?? t('admin.referralClaims.detail.tenantFallback'),
                amount: formatRupiah(parseFloat(request.totalAmountIdr)),
              })
            : t('admin.referralClaims.detail.loading')}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {isLoading || !request ? (
            <p className="text-sm text-gray-500">{t('admin.referralClaims.detail.loading')}</p>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('admin.referralClaims.detail.bankSectionTitle')}
                </h3>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{request.bankName ?? '—'}</span>
                    {request.accountNumber && (
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            request.accountNumber!,
                            t('admin.referralClaims.detail.copyAccountLabel'),
                          )
                        }
                        className="flex items-center gap-1 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t('admin.referralClaims.detail.copy')}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-base">{request.accountNumber ?? '—'}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('admin.referralClaims.detail.onBehalfTpl', {
                      name: request.accountHolderName ?? '—',
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      request.totalAmountIdr,
                      t('admin.referralClaims.detail.copyAmountLabel'),
                    )
                  }
                  className="flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400"
                >
                  <Copy className="h-3 w-3" />
                  {t('admin.referralClaims.detail.copyAmountTpl', {
                    amount: formatRupiah(parseFloat(request.totalAmountIdr)),
                  })}
                </button>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('admin.referralClaims.detail.commissionsTitleTpl', {
                    count: commissions.length,
                  })}
                </h3>
                <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('admin.referralClaims.detail.commissionsCol.date')}</TableHead>
                        <TableHead className="text-right">
                          {t('admin.referralClaims.detail.commissionsCol.amount')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissions.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm">
                            {formatDate(c.createdAt, 'dd MMM yyyy')}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatRupiah(parseFloat(c.amountIdr))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              {request.adminNotes && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t('admin.referralClaims.detail.adminNotesTitle')}
                  </h3>
                  <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
                    {request.adminNotes}
                  </p>
                </section>
              )}

              {!isClosed && (
                <>
                  <section className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t('admin.referralClaims.detail.notesLabel')}
                    </label>
                    <Textarea
                      placeholder={t('admin.referralClaims.detail.notesPlaceholder')}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                    />
                  </section>

                  {showRejectInput && (
                    <section className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {t('admin.referralClaims.detail.rejectLabel')}{' '}
                        <span className="text-danger-500">*</span>
                      </label>
                      <Textarea
                        placeholder={t('admin.referralClaims.detail.rejectPlaceholder')}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          {isClosed ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('admin.referralClaims.detail.close')}
            </Button>
          ) : showRejectInput ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowRejectInput(false)
                  setRejectReason('')
                }}
              >
                {t('admin.referralClaims.detail.cancel')}
              </Button>
              <Button type="button" variant="danger" loading={rejecting} onClick={handleReject}>
                {t('admin.referralClaims.detail.rejectConfirm')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('admin.referralClaims.detail.close')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowRejectInput(true)}>
                {t('admin.referralClaims.detail.reject')}
              </Button>
              <Button type="button" variant="brand" onClick={() => setConfirmPayOpen(true)}>
                {t('admin.referralClaims.detail.markPaid')}
              </Button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmPayOpen}
        onCancel={() => setConfirmPayOpen(false)}
        onConfirm={handleMarkPaid}
        title={t('admin.referralClaims.detail.confirmPayTitle')}
        description={t('admin.referralClaims.detail.confirmPayDescTpl', {
          amount: request ? formatRupiah(parseFloat(request.totalAmountIdr)) : '-',
        })}
        confirmText={t('admin.referralClaims.detail.confirmPayCta')}
        loading={paying}
      />
    </Sheet>
  )
}
