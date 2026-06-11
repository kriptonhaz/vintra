import * as React from 'react'
import { Banknote, QrCode, ArrowLeftRight, CreditCard, Smartphone } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/currency-input'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { POSPaymentMethod } from '@vintra/shared'

export interface PaymentModalResult {
  method: POSPaymentMethod
  /** What the customer pays toward this cart. */
  paidAmount: number
  /** True when the cart is (partly) on credit — the gap becomes kasbon. */
  isKasbon: boolean
  /** Amount paid toward the customer's EXISTING kasbon. */
  kasbonPayment: number
}

interface Props {
  open: boolean
  total: number
  allowedMethods: ReadonlyArray<POSPaymentMethod>
  /** Attached customer — kasbon requires one (null = anonymous). */
  customerId: string | null
  /** The attached customer's current outstanding kasbon. */
  customerKasbon: number
  onClose: () => void
  onConfirm: (input: PaymentModalResult) => void
  loading?: boolean
}

const METHOD_META: Record<
  POSPaymentMethod,
  { label: string; icon: React.ElementType; subtitle?: string }
> = {
  cash: { label: 'Tunai', icon: Banknote, subtitle: 'Hitung kembalian otomatis' },
  qris: { label: 'QRIS', icon: QrCode, subtitle: 'Scan QR di kasir' },
  transfer: { label: 'Transfer Bank', icon: ArrowLeftRight },
  card: { label: 'Kartu', icon: CreditCard, subtitle: 'Debit / kredit' },
  ewallet: { label: 'E-Wallet', icon: Smartphone, subtitle: 'DANA / lainnya' },
  gopay: { label: 'GoPay', icon: Smartphone, subtitle: 'E-wallet Gojek' },
  shopeepay: { label: 'ShopeePay', icon: Smartphone, subtitle: 'E-wallet Shopee' },
  ovo: { label: 'OVO', icon: Smartphone, subtitle: 'E-wallet OVO' },
}

const QUICK_PRESETS = [50000, 100000, 200000, 500000]

export function PaymentModal({
  open,
  total,
  allowedMethods,
  customerId,
  customerKasbon,
  onClose,
  onConfirm,
  loading,
}: Props) {
  const [method, setMethod] = React.useState<POSPaymentMethod>(
    allowedMethods[0] ?? 'cash',
  )
  const [paid, setPaid] = React.useState<number>(total)
  const [paidStr, setPaidStr] = React.useState<string>(total.toString())
  const [isKasbon, setIsKasbon] = React.useState(false)
  // "Bayar kasbon" — opt-in per transaction. Never pre-filled (JUR-191).
  const [kasbonPayStr, setKasbonPayStr] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setMethod(allowedMethods[0] ?? 'cash')
      setPaid(total)
      setPaidStr(total.toString())
      setIsKasbon(false)
      setKasbonPayStr('')
      setTouched(false)
    }
  }, [open, total, allowedMethods])

  const hasCustomer = customerId != null
  const showKasbonPay = hasCustomer && customerKasbon > 0

  // The cart-payment amount is editable for cash, and for any method
  // once the kasbon toggle is on ("Bayar transaksi ini").
  const amountEditable = method === 'cash' || isKasbon
  const cartPaid = amountEditable ? paid : total

  const change = method === 'cash' ? Math.max(0, cartPaid - total) : 0
  const kasbonGap = isKasbon ? Math.max(0, total - cartPaid) : 0
  const insufficient = !isKasbon && cartPaid < total

  const kasbonPay = parseInt(kasbonPayStr) || 0
  const kasbonOver = kasbonPay > customerKasbon

  const blocked = insufficient || kasbonOver

  function handleConfirm() {
    setTouched(true)
    if (blocked) return
    onConfirm({
      method,
      paidAmount: cartPaid,
      isKasbon,
      kasbonPayment: kasbonPay,
    })
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Pembayaran</DialogTitle>
        <DialogDescription>
          Total tagihan: {formatRupiah(total)}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Metode pembayaran
            </p>
            <div className="grid grid-cols-2 gap-2">
              {allowedMethods.map((m) => {
                const meta = METHOD_META[m]
                const Icon = meta.icon
                const active = method === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={cn(
                      'flex min-h-[68px] flex-col items-start gap-1 rounded-lg border p-3.5 text-left transition-colors active:scale-[0.98]',
                      active
                        ? 'border-brand-600 bg-brand-50 text-brand-900 dark:bg-brand-900/30 dark:text-brand-100'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        active ? 'text-brand-600' : 'text-gray-500',
                      )}
                    />
                    <span className="text-sm font-semibold">{meta.label}</span>
                    {meta.subtitle && (
                      <span className="text-xs text-gray-500">{meta.subtitle}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Kasbon toggle — only for an attached customer. */}
          {hasCustomer && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <input
                type="checkbox"
                checked={isKasbon}
                onChange={(e) => setIsKasbon(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600"
              />
              <span className="text-sm">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Transaksi kasbon
                </span>
                <span className="block text-xs text-gray-500">
                  Pelanggan bayar sebagian; sisanya jadi kasbon.
                </span>
              </span>
            </label>
          )}

          {(amountEditable) && (
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {isKasbon ? 'Bayar untuk transaksi ini' : 'Jumlah dibayar'}
              </p>
              <CurrencyInput
                value={paidStr}
                onChange={(v) => {
                  setPaidStr(v)
                  setPaid(parseInt(v) || 0)
                }}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setPaidStr(p.toString())
                      setPaid(p)
                    }}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {formatRupiah(p)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setPaidStr(total.toString())
                    setPaid(total)
                  }}
                  className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
                >
                  Pas
                </button>
              </div>
              <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total</span>
                  <span className="font-medium">{formatRupiah(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Dibayar</span>
                  <span className="font-medium">{formatRupiah(cartPaid)}</span>
                </div>
                <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                {isKasbon && kasbonGap > 0 ? (
                  <div className="flex justify-between text-base">
                    <span className="font-semibold">Jadi kasbon</span>
                    <span className="font-bold text-warning-700">
                      {formatRupiah(kasbonGap)}
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between text-base">
                    <span className="font-semibold">Kembalian</span>
                    <span
                      className={cn(
                        'font-bold',
                        insufficient ? 'text-danger-600' : 'text-success-600',
                      )}
                    >
                      {insufficient
                        ? `Kurang ${formatRupiah(total - cartPaid)}`
                        : formatRupiah(change)}
                    </span>
                  </div>
                )}
              </div>
              {touched && insufficient && (
                <p className="mt-1 text-xs text-danger-600">
                  Pembayaran kurang dari total. Sesuaikan, atau centang
                  "Transaksi kasbon" jika sisanya dikasbon.
                </p>
              )}
            </div>
          )}

          {method !== 'cash' && !isKasbon && (
            <div className="rounded-lg bg-brand-50 p-4 text-sm text-brand-900 dark:bg-brand-900/30 dark:text-brand-100">
              <p>
                Pastikan pelanggan sudah membayar via{' '}
                <span className="font-semibold">{METHOD_META[method].label}</span> sebesar{' '}
                <span className="font-bold">{formatRupiah(total)}</span> sebelum mencetak struk.
              </p>
            </div>
          )}

          {/* Bayar kasbon — pay down EXISTING kasbon. Opt-in, never
              pre-filled; the cashier types this only after the customer
              says they want to pay (JUR-191). */}
          {showKasbonPay && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-900/40 dark:bg-warning-900/20">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-warning-900 dark:text-warning-200">
                  Kasbon pelanggan saat ini
                </span>
                <span className="font-bold text-warning-900 dark:text-warning-200">
                  {formatRupiah(customerKasbon)}
                </span>
              </div>
              <p className="mb-2 text-xs text-warning-800 dark:text-warning-300">
                Tanyakan ke pelanggan — isi hanya jika mereka mau membayar
                kasbon sekarang.
              </p>
              <CurrencyInput
                value={kasbonPayStr}
                onChange={setKasbonPayStr}
                placeholder="Rp 0"
              />
              {kasbonOver && (
                <p className="mt-1 text-xs text-danger-600">
                  Maksimal {formatRupiah(customerKasbon)}.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Batal
        </Button>
        <Button
          variant="brand"
          onClick={handleConfirm}
          loading={loading}
          disabled={blocked || loading}
        >
          Selesai
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
