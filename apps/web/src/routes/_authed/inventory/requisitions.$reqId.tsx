import * as React from 'react'
import { createFileRoute, useRouter, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Check, X, Truck } from 'lucide-react'
import {
  getRequisition,
  approveRequisition,
  rejectRequisition,
  cancelRequisition,
  fulfillRequisition,
} from '@/server/functions/inventory-requisitions'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn, formatDate, formatNumberID } from '@/lib/utils'
import { formatRupiah } from '@/lib/currency'
import { STATUS_LABEL, statusColor } from './requisitions.index'

export const Route = createFileRoute('/_authed/inventory/requisitions/$reqId')({
  loader: ({ params }) => getRequisition({ data: { id: params.reqId } }),
  component: RequisitionDetailPage,
})

function RequisitionDetailPage() {
  const req = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()
  const [fulfillOpen, setFulfillOpen] = React.useState(false)
  // Fulfill draft — fulfilledQty per line, prefilled to the requested qty.
  const [fulfillQty, setFulfillQty] = React.useState<Record<string, string>>(
    {},
  )

  function refresh() {
    router.invalidate()
  }

  const approve = useMutation({
    mutationFn: () => approveRequisition({ data: { id: req.id } }),
    onSuccess: () => {
      toast({ title: 'Permintaan disetujui', variant: 'success' })
      refresh()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal', description: e.message, variant: 'error' }),
  })
  const reject = useMutation({
    mutationFn: () => rejectRequisition({ data: { id: req.id } }),
    onSuccess: () => {
      toast({ title: 'Permintaan ditolak', variant: 'success' })
      refresh()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal', description: e.message, variant: 'error' }),
  })
  const cancel = useMutation({
    mutationFn: () => cancelRequisition({ data: { id: req.id } }),
    onSuccess: () => {
      toast({ title: 'Permintaan dibatalkan', variant: 'success' })
      refresh()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal', description: e.message, variant: 'error' }),
  })
  const fulfill = useMutation({
    mutationFn: () =>
      fulfillRequisition({
        data: {
          id: req.id,
          lines: req.lines.map((l) => ({
            requisitionItemId: l.id,
            fulfilledQty: Number(fulfillQty[l.id] ?? l.requestedQty) || 0,
          })),
        },
      }),
    onSuccess: () => {
      toast({ title: 'Permintaan dipenuhi — stok dipindahkan', variant: 'success' })
      setFulfillOpen(false)
      refresh()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal memenuhi', description: e.message, variant: 'error' }),
  })

  function openFulfill() {
    setFulfillQty(
      Object.fromEntries(req.lines.map((l) => [l.id, String(l.requestedQty)])),
    )
    setFulfillOpen(true)
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/inventory/requisitions"
            className="mb-1 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Permintaan Stok
          </Link>
          <h1 className="font-mono text-2xl font-bold text-gray-900 dark:text-gray-100">
            {req.requisitionNumber}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {req.requestingBranchName} ← {req.sourceBranchName} ·{' '}
            {formatDate(req.createdAt, 'dd MMM yyyy, HH:mm')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
              statusColor(req.status),
            )}
          >
            {STATUS_LABEL[req.status as keyof typeof STATUS_LABEL] ?? req.status}
          </span>
          {req.status === 'pending' && (
            <>
              <Button
                variant="brand"
                onClick={() => approve.mutate()}
                loading={approve.isPending}
              >
                <Check className="h-4 w-4" /> Setujui
              </Button>
              <Button
                variant="outline"
                onClick={() => reject.mutate()}
                loading={reject.isPending}
              >
                <X className="h-4 w-4" /> Tolak
              </Button>
              <Button
                variant="ghost"
                onClick={() => cancel.mutate()}
                loading={cancel.isPending}
              >
                Batalkan
              </Button>
            </>
          )}
          {req.status === 'approved' && (
            <Button variant="brand" onClick={openFulfill}>
              <Truck className="h-4 w-4" /> Penuhi
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 dark:border-gray-700">
            <tr>
              <th className="p-3 text-left">Item</th>
              <th className="p-3 text-right">Diminta</th>
              <th className="p-3 text-right">Dipenuhi</th>
              {req.totalCost > 0 && (
                <>
                  <th className="p-3 text-right">Harga</th>
                  <th className="p-3 text-right">Subtotal</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {req.lines.map((l) => (
              <tr key={l.id}>
                <td className="p-3">
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {l.itemName}
                  </p>
                  {l.notes && (
                    <p className="text-xs text-gray-500">{l.notes}</p>
                  )}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {formatNumberID(l.requestedQty)} {l.unitLabel}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {req.status === 'fulfilled' ? (
                    <span
                      className={cn(
                        'font-medium',
                        l.fulfilledQty < l.requestedQty
                          ? 'text-warning-700 dark:text-warning-400'
                          : 'text-gray-900 dark:text-gray-100',
                      )}
                    >
                      {formatNumberID(l.fulfilledQty)} {l.unitLabel}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                {req.totalCost > 0 && (
                  <>
                    <td className="p-3 text-right tabular-nums">
                      {l.unitPrice != null ? formatRupiah(l.unitPrice) : '—'}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {l.unitPrice != null
                        ? formatRupiah(
                            l.unitPrice * l.requestedQty * l.unitRatio,
                          )
                        : '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {req.totalCost > 0 && (
            <tfoot className="border-t border-gray-200 dark:border-gray-700">
              <tr>
                <td
                  className="p-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                  colSpan={4}
                >
                  Total Pembelian dari Pusat
                </td>
                <td className="p-3 text-right font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {formatRupiah(req.totalCost)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {req.notes && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-1 text-xs font-medium text-gray-500">Catatan</p>
          <p className="text-gray-900 dark:text-gray-100">{req.notes}</p>
        </div>
      )}

      <Dialog open={fulfillOpen} onClose={() => setFulfillOpen(false)}>
        <DialogHeader>
          <DialogTitle>Penuhi permintaan</DialogTitle>
          <DialogDescription>
            Konfirmasi jumlah yang dikirim. Stok pindah dari{' '}
            {req.sourceBranchName} ke {req.requestingBranchName}.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-3">
            {req.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {l.itemName}
                  </p>
                  <p className="text-xs text-gray-500">
                    Diminta {formatNumberID(l.requestedQty)} {l.unitLabel}
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={fulfillQty[l.id] ?? ''}
                  onChange={(e) =>
                    setFulfillQty((p) => ({ ...p, [l.id]: e.target.value }))
                  }
                  className="w-28 tabular-nums"
                />
              </div>
            ))}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setFulfillOpen(false)}
            disabled={fulfill.isPending}
          >
            Batal
          </Button>
          <Button
            variant="brand"
            onClick={() => fulfill.mutate()}
            loading={fulfill.isPending}
          >
            Penuhi &amp; Pindahkan Stok
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
