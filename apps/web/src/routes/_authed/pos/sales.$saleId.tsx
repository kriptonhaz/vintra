import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Download,
  Printer,
  MessageCircle,
  X,
  BluetoothConnected,
} from 'lucide-react'
import { getSale, voidSale } from '@/server/functions/pos'
import { listVoidCategories } from '@/server/functions/pos-void-categories'
import { getSaleReceiptPDF } from '@/server/functions/pos-receipt'
import { printPdfDataUrl, downloadPdfDataUrl } from '@/lib/print-pdf'
import { useThermalPrinter } from '@/hooks/use-thermal-printer'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { usePermissions, useCurrentUser } from '@/hooks/use-permissions'
import { canVoidSale } from '@/lib/pos-permissions'
import { formatRupiah } from '@/lib/currency'
import { dateKeyJakarta } from '@/lib/jakarta-time'
import { formatDate } from '@/lib/utils' // JUR-137

export const Route = createFileRoute('/_authed/pos/sales/$saleId')({
  loader: ({ params }) => getSale({ data: { id: params.saleId } }),
  component: SaleDetailPage,
})

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-Wallet',
}

function SaleDetailPage() {
  const sale = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()
  const { has } = usePermissions()
  const { data: currentUser } = useCurrentUser()
  const { isPaired, printReceipt } = useThermalPrinter()
  const tenantName = currentUser?.tenant?.businessName ?? 'Toko'
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [voidReason, setVoidReason] = React.useState('')
  const [voidCategoryId, setVoidCategoryId] = React.useState('')

  // JUR-204: tenant-curated dropdown above the Alasan textarea. Only
  // fetch once the cashier actually opens the void modal so the page
  // load stays cheap. Picker is required — voidSale rejects blank.
  const voidCategories = useQuery({
    queryKey: ['pos', 'void-categories', 'active'],
    queryFn: () => listVoidCategories({ data: {} }),
    enabled: voidOpen,
    staleTime: 5 * 60 * 1000,
  })

  const isToday = dateKeyJakarta(new Date(sale.createdAt)) === dateKeyJakarta(new Date())
  const canVoid = canVoidSale(has) && sale.status !== 'voided' && isToday

  const downloadPDF = useMutation({
    mutationFn: (layout: 'thermal-80mm' | 'a4') =>
      getSaleReceiptPDF({ data: { id: sale.id, layout } }),
    onSuccess: (data) => {
      downloadPdfDataUrl(data.dataUrl, data.fileName)
    },
  })

  const printPDF = useMutation({
    mutationFn: () =>
      getSaleReceiptPDF({ data: { id: sale.id, layout: 'thermal-80mm' } }),
    onSuccess: (data) => {
      printPdfDataUrl(data.dataUrl)
    },
  })

  /**
   * JUR-12 — when a Bluetooth thermal printer is paired on this
   * device, Cetak streams ESC/POS straight to it (shared pipeline
   * with the post-sale success modal). Otherwise it falls back to
   * the PDF preview.
   */
  const printThermal = useMutation({
    mutationFn: () => printReceipt(sale.id),
    onSuccess: () => {
      toast({ title: 'Struk dikirim ke printer', variant: 'success' })
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal mencetak via Bluetooth',
        description: err.message || 'Periksa daya printer, lalu coba lagi',
        variant: 'error',
      })
    },
  })

  /**
   * Text-only WhatsApp share — no PDF link. Receipts aren't persisted
   * to S3 (bloat + most merchants never use the link). If the customer wants
   * the actual PDF, the cashier downloads it and attaches manually.
   */
  function shareWA() {
    const phone = (sale.customerPhone ?? '').replace(/\D/g, '')
    const summary = `Halo, terima kasih atas pembelian Anda di ${tenantName}.
No: ${sale.saleNumber}
Total: ${formatRupiah(Number(sale.total))}
Tanggal: ${formatDate(sale.createdAt, 'dd MMM yyyy, HH:mm')}`
    const base = phone ? `https://wa.me/${normalizeWa(phone)}` : `https://wa.me/`
    window.open(`${base}?text=${encodeURIComponent(summary)}`, '_blank')
  }

  const voidMut = useMutation({
    mutationFn: () =>
      voidSale({
        data: {
          id: sale.id,
          reason: voidReason,
          categoryId: voidCategoryId || undefined,
        },
      }),
    onSuccess: () => {
      toast({ title: 'Transaksi dibatalkan', variant: 'success' })
      setVoidOpen(false)
      setVoidCategoryId('')
      router.invalidate()
    },
    onError: (err: Error) => {
      toast({ title: 'Gagal membatalkan', description: err.message, variant: 'error' })
    },
  })

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {sale.saleNumber}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {formatDate(sale.createdAt, 'dd MMM yyyy, HH:mm')} • {sale.branchName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadPDF.mutate('thermal-80mm')}>
            <Download className="h-4 w-4" /> Unduh
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              isPaired ? printThermal.mutate() : printPDF.mutate()
            }
            loading={isPaired ? printThermal.isPending : printPDF.isPending}
          >
            {isPaired ? (
              <>
                <BluetoothConnected className="h-4 w-4" /> Cetak Thermal
              </>
            ) : (
              <>
                <Printer className="h-4 w-4" /> Cetak
              </>
            )}
          </Button>
          <Button variant="brand" onClick={shareWA}>
            <MessageCircle className="h-4 w-4" /> Bagikan WA
          </Button>
          {canVoid && (
            <Button variant="danger" onClick={() => setVoidOpen(true)}>
              <X className="h-4 w-4" /> Batalkan
            </Button>
          )}
        </div>
      </div>

      {sale.status === 'voided' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
          <p className="font-semibold">Transaksi ini telah dibatalkan.</p>
          {sale.voidReason && (
            <p className="mt-1">Alasan: {sale.voidReason}</p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
            Item
          </h3>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 dark:border-gray-700">
              <tr>
                <th className="py-2 text-left">Nama</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Harga</th>
                <th className="py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {sale.items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2.5">
                    {it.nameSnapshot}
                    {it.isAdhoc && (
                      <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        ad-hoc
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">{Number(it.qty)}</td>
                  <td className="py-2.5 text-right">
                    {formatRupiah(Number(it.unitPrice))}
                  </td>
                  <td className="py-2.5 text-right font-medium">
                    {formatRupiah(Number(it.subtotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 text-sm dark:border-gray-700 dark:bg-gray-800">
          <Row label="Subtotal" value={formatRupiah(Number(sale.subtotal))} />
          {Number(sale.discountAmount) > 0 && (
            <Row
              label={
                sale.discountType === 'percent'
                  ? `Diskon ${Number(sale.discountValue ?? 0)}%`
                  : 'Diskon'
              }
              value={`-${formatRupiah(Number(sale.discountAmount))}`}
            />
          )}
          {Number(sale.taxAmount) > 0 && (
            <Row label="Pajak" value={formatRupiah(Number(sale.taxAmount))} />
          )}
          <div className="border-t border-gray-200 pt-2 dark:border-gray-700">
            <Row label="TOTAL" value={formatRupiah(Number(sale.total))} bold />
          </div>
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
            <Row
              label={`Bayar (${PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod})`}
              value={formatRupiah(Number(sale.paidAmount))}
            />
            {Number(sale.changeAmount) > 0 && (
              <Row
                label="Kembalian"
                value={formatRupiah(Number(sale.changeAmount))}
              />
            )}
          </div>
          {sale.customerName && (
            <div className="border-t border-gray-200 pt-2 text-xs dark:border-gray-700">
              <p className="text-gray-500">Pelanggan</p>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {sale.customerName}
                {sale.customerPhone && ` • ${sale.customerPhone}`}
              </p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)}>
        <DialogHeader>
          <DialogTitle>Batalkan transaksi?</DialogTitle>
          <DialogDescription>
            Stok akan dikembalikan ke inventory. Aksi ini tidak bisa dibatalkan.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Kategori pembatalan
              </label>
              <select
                value={voidCategoryId}
                onChange={(e) => setVoidCategoryId(e.target.value)}
                disabled={voidCategories.isLoading}
                className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">
                  {voidCategories.isLoading
                    ? 'Memuat…'
                    : 'Pilih kategori…'}
                </option>
                {(voidCategories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Alasan tambahan
              </label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Detail tambahan untuk catatan internal…"
                rows={3}
                className="w-full rounded-md border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVoidOpen(false)} disabled={voidMut.isPending}>
            Tidak
          </Button>
          <Button
            variant="danger"
            onClick={() => voidMut.mutate()}
            loading={voidMut.isPending}
            disabled={!voidReason.trim() || !voidCategoryId}
          >
            Ya, batalkan
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-semibold text-gray-900' : 'text-gray-600'}>{label}</span>
      <span className={bold ? 'text-base font-bold' : 'font-medium text-gray-900 dark:text-gray-100'}>
        {value}
      </span>
    </div>
  )
}

function normalizeWa(digits: string): string {
  if (digits.startsWith('0')) return '62' + digits.slice(1)
  if (digits.startsWith('62')) return digits
  return '62' + digits
}
