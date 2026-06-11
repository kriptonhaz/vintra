import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircle2,
  Download,
  Printer,
  MessageCircle,
  BluetoothConnected,
} from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  getSaleDataForPrinter,
  getSaleReceiptPDF,
} from '@/server/functions/pos-receipt'
import { printPdfDataUrl, downloadPdfDataUrl } from '@/lib/print-pdf'
import { formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import { useThermalPrinter } from '@/hooks/use-thermal-printer'

interface LoyaltyEcho {
  pointsEarned: number
  pointsRedeemed: number
  newBalance: number
  priorBalance: number
  redeemAmount: number
}

interface Props {
  open: boolean
  saleId: string | null
  saleNumber: string | null
  customerPhone?: string | null
  tenantName: string
  total: number
  /** Loyalty earn/redeem snapshot returned by createSale, or null
   *  when the sale wasn't loyalty-eligible. */
  loyalty?: LoyaltyEcho | null
  onClose: () => void
  onNewSale: () => void
}

export function SaleSuccessModal({
  open,
  saleId,
  saleNumber,
  customerPhone,
  tenantName,
  total,
  loyalty,
  onClose,
  onNewSale,
}: Props) {
  const { toast } = useToast()
  const { isPaired, printer, printReceipt } = useThermalPrinter()

  const downloadPDF = useMutation({
    mutationFn: async (layout: 'thermal-80mm' | 'a4') => {
      if (!saleId) throw new Error('No sale')
      return getSaleReceiptPDF({ data: { id: saleId, layout } })
    },
    onSuccess: (data) => {
      downloadPdfDataUrl(data.dataUrl, data.fileName)
    },
    onError: () => {
      toast({ title: 'Gagal mengunduh PDF', variant: 'error' })
    },
  })

  const printPDF = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error('No sale')
      return getSaleReceiptPDF({
        data: { id: saleId, layout: 'thermal-80mm' },
      })
    },
    onSuccess: (data) => {
      printPdfDataUrl(data.dataUrl)
    },
    onError: () => {
      toast({ title: 'Gagal membuka pratinjau cetak', variant: 'error' })
    },
  })

  /**
   * JUR-12 — when a Bluetooth thermal printer is paired (per device,
   * via Pengaturan POS), Cetak streams ESC/POS bytes straight to it
   * instead of opening the browser print dialog. The full pipeline
   * (fetch payload → dither logo → render ESC/POS → write) lives in
   * `useThermalPrinter().printReceipt`, shared with the transaction-
   * history detail page.
   */
  const printThermal = useMutation({
    mutationFn: async () => {
      if (!saleId) throw new Error('No sale')
      await printReceipt(saleId)
    },
    onSuccess: () => {
      toast({
        title: 'Struk dikirim ke printer',
        variant: 'success',
      })
    },
    onError: (err) => {
      toast({
        title: 'Gagal mencetak via Bluetooth',
        description:
          err instanceof Error
            ? err.message
            : 'Periksa daya printer, lalu coba lagi',
        variant: 'error',
      })
    },
  })

  /**
   * WhatsApp share = text-only summary (no link to a hosted PDF).
   * Most merchants don't need an online receipt, and persisting receipts
   * to S3 just bloats storage with files nobody reads. If the
   * customer asks for a PDF, the cashier can download + send it
   * manually as a WhatsApp attachment.
   */
  function shareWA() {
    const phone = (customerPhone ?? '').replace(/\D/g, '')
    const summary = `Halo, terima kasih atas pembelian Anda di ${tenantName}.
No: ${saleNumber}
Total: ${formatIdr(total)}
Tanggal: ${formatDate(new Date(), 'dd MMM yyyy, HH:mm')}`
    const base = phone ? `https://wa.me/${normalizeWaPhone(phone)}` : `https://wa.me/`
    const href = `${base}?text=${encodeURIComponent(summary)}`
    window.open(href, '_blank')
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success-100">
            <CheckCircle2 className="h-6 w-6 text-success-600" />
          </div>
          <div>
            <DialogTitle>Transaksi Berhasil</DialogTitle>
            <DialogDescription>
              No. {saleNumber} • Total {formatIdr(total)}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          {loyalty &&
            (loyalty.pointsEarned > 0 || loyalty.pointsRedeemed > 0) && (
              <div className="rounded-lg bg-brand-50 p-3 text-xs dark:bg-brand-900/20">
                <p className="font-medium text-brand-900 dark:text-brand-200">
                  Loyalty pelanggan
                </p>
                <ul className="mt-1 space-y-0.5 text-brand-800 dark:text-brand-300">
                  {loyalty.pointsRedeemed > 0 && (
                    <li>
                      Ditukar:{' '}
                      <strong>
                        {formatNumberID(loyalty.pointsRedeemed)} poin
                      </strong>{' '}
                      ({formatIdr(loyalty.redeemAmount)})
                    </li>
                  )}
                  {loyalty.pointsEarned > 0 && (
                    <li>
                      Diperoleh:{' '}
                      <strong>
                        +{formatNumberID(loyalty.pointsEarned)} poin
                      </strong>
                    </li>
                  )}
                  <li>
                    Saldo baru:{' '}
                    <strong>
                      {formatNumberID(loyalty.newBalance)} poin
                    </strong>
                  </li>
                </ul>
              </div>
            )}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Cetak struk atau bagikan ringkasan ke pelanggan via WhatsApp.
          </p>
          {/* Stack vertically on mobile (full-width, easier to tap),
              3-column on tablet+. WA gets the brand colour because
              text-only sharing is the most common path on mobile. */}
          <div className="flex flex-col gap-2 sm:grid sm:grid-cols-3">
            <Button
              variant="brand"
              size="lg"
              onClick={shareWA}
              className="sm:order-3"
            >
              <MessageCircle className="h-4 w-4" />
              Bagikan WA
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() =>
                isPaired ? printThermal.mutate() : printPDF.mutate()
              }
              loading={isPaired ? printThermal.isPending : printPDF.isPending}
              className="sm:order-2"
            >
              {isPaired ? (
                <>
                  <BluetoothConnected className="h-4 w-4" />
                  Cetak Thermal
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  Cetak
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => downloadPDF.mutate('thermal-80mm')}
              loading={downloadPDF.isPending}
              className="sm:order-1"
            >
              <Download className="h-4 w-4" /> Unduh PDF
            </Button>
          </div>
          {isPaired && printer && (
            <p className="flex items-center gap-1 text-xs text-success-700 dark:text-success-300">
              <BluetoothConnected className="h-3 w-3" />
              Terhubung: {printer.deviceName} ({printer.paperWidth}mm)
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadPDF.mutate('a4')}
            className="text-xs text-gray-500 underline"
          >
            Atau unduh format A4
          </button>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} className="sm:w-auto w-full">
          Tutup
        </Button>
        <Button
          variant="default"
          size="lg"
          onClick={onNewSale}
          className="sm:w-auto w-full"
        >
          Transaksi Baru
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function formatIdr(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

/**
 * Normalise an Indonesian phone for the wa.me URL. wa.me wants the
 * country-coded form WITHOUT a leading +. "08123" → "628123".
 */
function normalizeWaPhone(digits: string): string {
  if (digits.startsWith('0')) return '62' + digits.slice(1)
  if (digits.startsWith('62')) return digits
  return '62' + digits
}
