/**
 * Toko Online — admin order inbox (Phase 4).
 *
 * Komplit-gated (same as Situs). Lists online orders with a status
 * filter and a slide-over detail panel where the owner confirms
 * payment (deducts stock), marks shipped/ready (with courier + resi),
 * completes, or cancels (restocks).
 */
import * as React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Package } from 'lucide-react'
import {
  listOnlineOrders,
  getOnlineOrder,
  confirmOnlineOrder,
  fulfillOnlineOrder,
  completeOnlineOrder,
  cancelOnlineOrder,
} from '@/server/functions/online-orders'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/site/orders')({
  beforeLoad: ({ context }) => {
    const user = (
      context as {
        user?: {
          permissions?: string[]
          moduleSubscriptions?: { pos?: { features?: ReadonlyArray<string> } }
        }
      }
    ).user
    if (!user?.permissions?.includes('booking.write')) {
      throw redirect({ to: '/dashboard' })
    }
    if (!user.moduleSubscriptions?.pos?.features?.includes('tenant_site')) {
      throw redirect({ to: '/site/locked' })
    }
  },
  component: OrdersPage,
})

type StatusKey =
  | 'pending'
  | 'confirmed'
  | 'ready'
  | 'shipped'
  | 'completed'
  | 'cancelled'

const STATUS_LABEL: Record<StatusKey, string> = {
  pending: 'Menunggu',
  confirmed: 'Dikonfirmasi',
  ready: 'Siap diambil',
  shipped: 'Dikirim',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

const STATUS_STYLE: Record<StatusKey, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  confirmed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ready: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  shipped: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

const FILTERS: Array<{ value: StatusKey | 'all'; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'confirmed', label: 'Dikonfirmasi' },
  { value: 'shipped', label: 'Dikirim' },
  { value: 'ready', label: 'Siap diambil' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
]

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function OrdersPage() {
  const [filter, setFilter] = React.useState<StatusKey | 'all'>('all')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const list = useQuery({
    queryKey: ['online-orders', filter],
    queryFn: () =>
      listOnlineOrders({
        data: filter === 'all' ? undefined : { status: filter },
      }),
    staleTime: 15_000,
  })

  const orders = list.data ?? []

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Pesanan Online
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Kelola pesanan dari toko online — konfirmasi pembayaran, kirim, dan
          lacak status.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium',
              filter === f.value
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <p className="text-sm text-gray-500">Memuat…</p>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-gray-700">
          <Package className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          Belum ada pesanan.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500 dark:bg-gray-800/50">
              <tr>
                <th className="px-4 py-3">No. Pesanan</th>
                <th className="px-4 py-3">Pelanggan</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                    {o.orderNumber}
                    <span className="ml-2 text-xs text-gray-400">
                      {o.itemCount} item
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900 dark:text-gray-100">
                      {o.customerName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {o.fulfillmentType === 'pickup' ? 'Ambil' : 'Kirim'}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatRupiah(Number(o.total))}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_STYLE[o.status as StatusKey],
                      )}
                    >
                      {STATUS_LABEL[o.status as StatusKey] ?? o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {fmtDate(o.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <OrderDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [courier, setCourier] = React.useState('')
  const [resi, setResi] = React.useState('')
  const [cancelReason, setCancelReason] = React.useState('')

  const detail = useQuery({
    queryKey: ['online-order', id],
    queryFn: () => getOnlineOrder({ data: { id } }),
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ['online-orders'] })
    qc.invalidateQueries({ queryKey: ['online-order', id] })
  }

  function onOk(msg: string) {
    toast({ title: msg, variant: 'success' })
    refresh()
  }
  function onFail(e: Error) {
    toast({ title: 'Gagal', description: e.message, variant: 'error' })
  }

  const confirm = useMutation({
    mutationFn: () => confirmOnlineOrder({ data: { id } }),
    onSuccess: () => onOk('Pesanan dikonfirmasi'),
    onError: onFail,
  })
  const fulfill = useMutation({
    mutationFn: () =>
      fulfillOnlineOrder({
        data: { id, courierName: courier || null, trackingNumber: resi || null },
      }),
    onSuccess: () => onOk('Status diperbarui'),
    onError: onFail,
  })
  const complete = useMutation({
    mutationFn: () => completeOnlineOrder({ data: { id } }),
    onSuccess: () => onOk('Pesanan selesai'),
    onError: onFail,
  })
  const cancel = useMutation({
    mutationFn: () => cancelOnlineOrder({ data: { id, reason: cancelReason || undefined } }),
    onSuccess: () => onOk('Pesanan dibatalkan'),
    onError: onFail,
  })

  const order = detail.data?.order
  const items = detail.data?.items ?? []
  const status = order?.status as StatusKey | undefined
  const busy =
    confirm.isPending || fulfill.isPending || complete.isPending || cancel.isPending

  return (
    <div className="fixed inset-0 z-[950] flex justify-end" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {order?.orderNumber ?? 'Pesanan'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {detail.isLoading || !order ? (
            <p className="text-sm text-gray-500">Memuat…</p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-medium',
                    STATUS_STYLE[status as StatusKey],
                  )}
                >
                  {STATUS_LABEL[status as StatusKey] ?? status}
                </span>
                <span className="text-xs text-gray-500">
                  {fmtDate(order.createdAt)}
                </span>
              </div>

              {/* Customer */}
              <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {order.customerName}
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  {order.customerPhone}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {order.fulfillmentType === 'pickup'
                    ? 'Ambil di tempat'
                    : 'Dikirim'}
                </p>
                {order.fulfillmentType === 'delivery' && order.shippingAddress && (
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {order.shippingAddress}
                    {order.shippingZoneLabel
                      ? ` — ${order.shippingZoneLabel}`
                      : ''}
                  </p>
                )}
                {order.customerNote && (
                  <p className="mt-1 text-xs italic text-gray-500">
                    Catatan: {order.customerNote}
                  </p>
                )}
              </div>

              {/* Items */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="flex justify-between border-b border-gray-100 px-3 py-2 text-sm last:border-0 dark:border-gray-800"
                  >
                    <span className="text-gray-800 dark:text-gray-200">
                      {it.nameSnapshot}
                      {it.variantLabel && (
                        <span className="text-gray-500"> · {it.variantLabel}</span>
                      )}{' '}
                      <span className="text-gray-400">×{Number(it.qty)}</span>
                    </span>
                    <span className="tabular-nums">
                      {formatRupiah(Number(it.subtotal))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-1 text-sm">
                <Row label="Subtotal" value={formatRupiah(Number(order.subtotal))} />
                {Number(order.promoAmount) > 0 && (
                  <Row
                    label={`Promo ${order.promoCodeSnapshot ?? ''}`}
                    value={`−${formatRupiah(Number(order.promoAmount))}`}
                  />
                )}
                {Number(order.taxAmount) > 0 && (
                  <Row label="Pajak" value={formatRupiah(Number(order.taxAmount))} />
                )}
                {order.fulfillmentType === 'delivery' && (
                  <Row label="Ongkir" value={formatRupiah(Number(order.shippingFee))} />
                )}
                <div className="flex justify-between border-t border-gray-200 pt-1 text-base font-bold dark:border-gray-700">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatRupiah(Number(order.total))}
                  </span>
                </div>
                <p className="pt-1 text-xs text-gray-500">
                  Bayar via{' '}
                  <span className="font-medium">{order.paymentMethod}</span>
                </p>
              </div>

              {/* Shipment info if present */}
              {(order.courierName || order.trackingNumber) && (
                <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
                  <p className="text-gray-700 dark:text-gray-300">
                    {order.courierName}
                  </p>
                  {order.trackingNumber && (
                    <p className="tabular-nums text-gray-600 dark:text-gray-400">
                      Resi: {order.trackingNumber}
                    </p>
                  )}
                </div>
              )}

              {/* Fulfill inputs (delivery, when confirmed) */}
              {status === 'confirmed' && order.fulfillmentType === 'delivery' && (
                <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Info pengiriman
                  </p>
                  <Input
                    label="Kurir"
                    value={courier}
                    onChange={(e) => setCourier(e.target.value)}
                    placeholder="cth. JNE, J&T, GoSend"
                  />
                  <Input
                    label="No. Resi"
                    value={resi}
                    onChange={(e) => setResi(e.target.value)}
                    placeholder="Nomor resi"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action footer */}
        {order && status && status !== 'completed' && status !== 'cancelled' && (
          <div className="space-y-2 border-t border-gray-200 px-5 py-4 dark:border-gray-700">
            {status === 'pending' && (
              <Button
                variant="brand"
                className="w-full"
                loading={confirm.isPending}
                disabled={busy}
                onClick={() => confirm.mutate()}
              >
                Konfirmasi pembayaran (potong stok)
              </Button>
            )}
            {status === 'confirmed' && (
              <Button
                variant="brand"
                className="w-full"
                loading={fulfill.isPending}
                disabled={busy}
                onClick={() => fulfill.mutate()}
              >
                {order.fulfillmentType === 'pickup'
                  ? 'Tandai siap diambil'
                  : 'Tandai dikirim'}
              </Button>
            )}
            {(status === 'ready' || status === 'shipped') && (
              <Button
                variant="brand"
                className="w-full"
                loading={complete.isPending}
                disabled={busy}
                onClick={() => complete.mutate()}
              >
                Selesaikan pesanan
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Alasan batal (opsional)"
                className="flex-1"
              />
              <Button
                variant="ghost"
                loading={cancel.isPending}
                disabled={busy}
                onClick={() => cancel.mutate()}
                className="text-red-600"
              >
                Batalkan
              </Button>
            </div>
            {busy && (
              <p className="flex items-center justify-center gap-1 text-xs text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Memproses…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
