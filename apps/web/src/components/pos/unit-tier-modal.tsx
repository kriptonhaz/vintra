import * as React from 'react'
import { Plus, Minus, Tag } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/currency'
import { cn, formatNumberID } from '@/lib/utils' // JUR-137
import type { POSProduct, POSProductUnit } from './cashier-product-grid'

export interface UnitTierSelection {
  unitId: string
  unitLabel: string
  ratioToBase: number
  qty: number
  unitPrice: number
  isBulk: boolean
  /** Min qty of the matched tier — useful for "next bulk threshold" hints. */
  matchedMinQty: number
}

interface Props {
  open: boolean
  product: POSProduct | null
  /** Optional: pre-select this unit when the modal opens (e.g. re-edit cart line). */
  initialUnitId?: string
  initialQty?: number
  /**
   * Stock (in BASE units) ALREADY committed in the cart for this item
   * across all of its unit lines. Subtracted from `product.stockInBase`
   * to compute the true remaining cap. 0 if the item isn't in the cart yet.
   */
  reservedInBase?: number
  onClose: () => void
  onConfirm: (sel: UnitTierSelection) => void
}

/**
 * Pop-up that opens when the cashier taps a multi-unit product (or
 * any product when bulk pricing matters). Lets them pick the unit,
 * adjust qty, and snap to bulk tiers automatically.
 *
 * UX pattern from Moka POS / Loyverse: chips for unit choice,
 * stepper for qty, live tier preview + "next bulk" nudge.
 */
export function UnitTierModal({
  open,
  product,
  initialUnitId,
  initialQty = 1,
  reservedInBase = 0,
  onClose,
  onConfirm,
}: Props) {
  const [unitId, setUnitId] = React.useState<string>('')
  const [qty, setQty] = React.useState<number>(initialQty)
  /**
   * Separate string state for the qty input so the user can momentarily
   * clear it (e.g. backspace "1" before typing "50") without React
   * snapping it back. We push the parsed number to `qty` only when the
   * string parses to a positive value; an empty/invalid string keeps
   * the last valid number around for tier math but shows blank in the
   * input. On blur we reset to "1" if the user left it empty.
   */
  const [qtyInput, setQtyInput] = React.useState<string>(String(initialQty))

  React.useEffect(() => {
    if (!open || !product) return
    // Default to: first unit (matches product card's "starting from" unit)
    // unless caller pre-selected one.
    const initial =
      initialUnitId && product.units.find((u) => u.unitId === initialUnitId)
        ? initialUnitId
        : product.units[0]?.unitId ?? ''
    setUnitId(initial)
    const startQty = initialQty || 1
    setQty(startQty)
    setQtyInput(String(startQty))
  }, [open, product, initialUnitId, initialQty])

  if (!product) return null
  const unit = product.units.find((u) => u.unitId === unitId)

  // Tier match: highest min_qty whose threshold ≤ current qty.
  const sortedTiers = unit ? [...unit.tiers].sort((a, b) => a.minQty - b.minQty) : []
  const matchedTier = unit
    ? [...unit.tiers].filter((t) => qty >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0]
    : undefined
  const isBulk = matchedTier ? matchedTier.minQty > 1 : false

  // Next bulk tier the customer hasn't hit yet — useful nudge.
  const nextTier = unit
    ? sortedTiers.find((t) => t.minQty > qty)
    : undefined

  // Stock check (in BASE unit; we convert). Reserved stock = qty
  // already in the cart for this item under any unit. Available =
  // physical stock minus what's already pending.
  const availableInBase = Math.max(0, product.stockInBase - reservedInBase)
  const maxQtyInUnit = unit
    ? unit.ratioToBase > 0
      ? availableInBase / unit.ratioToBase
      : 0
    : 0
  const requiredBase = unit ? qty * unit.ratioToBase : 0
  const insufficientStock = requiredBase > availableInBase

  const subtotal = matchedTier ? matchedTier.unitPrice * qty : 0

  function handleConfirm() {
    if (!unit || !matchedTier) return
    if (insufficientStock) return // hard block — button is disabled too
    onConfirm({
      unitId: unit.unitId,
      unitLabel: unit.unitLabel,
      ratioToBase: unit.ratioToBase,
      qty,
      unitPrice: matchedTier.unitPrice,
      isBulk,
      matchedMinQty: matchedTier.minQty,
    })
  }

  /** Set qty without exceeding the per-unit max derived from stock. */
  function setQtyClamped(next: number) {
    const safeMax = maxQtyInUnit > 0 ? maxQtyInUnit : 0
    if (next < 0.0001) {
      setQty(0.0001)
      setQtyInput('0.0001')
      return
    }
    const clamped = Math.min(next, safeMax)
    setQty(clamped)
    setQtyInput(String(clamped))
  }

  /**
   * Input onChange — accept ANY string (incl. empty + partial decimals
   * like "0." or "1.") so the user can edit freely. Parse on the fly:
   * if it's a valid positive number, push to `qty` (clamped). Otherwise
   * keep the previous `qty` and let the input show the raw string.
   */
  function handleQtyInputChange(raw: string) {
    setQtyInput(raw)
    if (raw === '') return // user cleared it; keep qty at last valid
    const v = parseFloat(raw)
    if (Number.isNaN(v) || v <= 0) return
    const clamped = Number.isFinite(maxQtyInUnit) && maxQtyInUnit > 0
      ? Math.min(v, maxQtyInUnit)
      : v
    setQty(clamped)
  }

  /** On blur, normalise the visible string. Empty/invalid → snap to "1". */
  function handleQtyInputBlur() {
    if (qtyInput === '' || Number.isNaN(parseFloat(qtyInput))) {
      const fallback = 1
      setQty(fallback)
      setQtyInput(String(fallback))
      return
    }
    setQtyInput(String(qty))
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{product.name}</DialogTitle>
        <DialogDescription>
          Pilih unit dan jumlah. Harga grosir otomatis berlaku saat qty
          mencapai tier.
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          {/* Unit picker */}
          {product.units.length > 1 && (
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Unit
              </p>
              <div className="flex flex-wrap gap-1.5">
                {product.units.map((u) => {
                  const tier1 = u.tiers.find((t) => t.minQty === 1)
                  return (
                    <button
                      key={u.unitId}
                      type="button"
                      onClick={() => setUnitId(u.unitId)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                        u.unitId === unitId
                          ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-900/30 dark:text-brand-100'
                          : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                      )}
                    >
                      <span className="font-medium">{u.unitLabel}</span>
                      {tier1 && (
                        <span className="text-xs text-gray-500">
                          {formatRupiah(tier1.unitPrice)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Qty stepper — capped at maxQtyInUnit (= available stock / ratio) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Jumlah
              </p>
              {unit && (
                <p className="text-xs text-gray-500">
                  Maks: {formatQty(maxQtyInUnit)} {unit.unitLabel}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQtyClamped(Math.max(0.0001, qty - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:active:bg-gray-600"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                value={qtyInput}
                min={0.0001}
                max={maxQtyInUnit || undefined}
                step="any"
                onChange={(e) => handleQtyInputChange(e.target.value)}
                onBlur={handleQtyInputBlur}
                className="h-10 w-24 rounded-md border border-gray-200 bg-white px-2 text-center text-base text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={() => setQtyClamped(qty + 1)}
                disabled={qty >= maxQtyInUnit}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:active:bg-gray-600 dark:disabled:hover:bg-gray-800"
              >
                <Plus className="h-4 w-4" />
              </button>
              {unit && (
                <span className="text-sm text-gray-500">{unit.unitLabel}</span>
              )}
              {/* Quick-pick the next bulk tier (only if it's reachable). */}
              {nextTier && nextTier.minQty <= maxQtyInUnit && (
                <button
                  type="button"
                  onClick={() => setQtyClamped(nextTier.minQty)}
                  className="rounded-full border border-accent-200 bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-700 hover:bg-accent-100"
                  title={`Snap ke tier berikutnya (${nextTier.minQty})`}
                >
                  Grosir {nextTier.minQty}+
                </button>
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            {!matchedTier ? (
              <p className="text-sm text-warning-700">
                Tidak ada tier untuk qty ini. Tambah tier di Inventory.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Harga</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {formatRupiah(matchedTier.unitPrice)} / {unit?.unitLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Qty</span>
                  <span>
                    {qty} {unit?.unitLabel}
                  </span>
                </div>
                {isBulk && (
                  <div className="mt-1 flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5 text-accent-700" />
                    <span className="text-xs font-medium text-accent-700 dark:text-accent-400">
                      Harga grosir aktif (≥ {matchedTier.minQty} {unit?.unitLabel})
                    </span>
                  </div>
                )}
                {nextTier && !isBulk && (
                  <p className="mt-1 text-xs text-gray-500">
                    Tambah {nextTier.minQty - qty} {unit?.unitLabel} lagi untuk
                    dapat harga grosir {formatRupiah(nextTier.unitPrice)}.
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 text-base dark:border-gray-700">
                  <span className="font-semibold">Subtotal</span>
                  <span className="font-bold text-brand-700 dark:text-brand-300">
                    {formatRupiah(subtotal)}
                  </span>
                </div>
                {unit && unit.ratioToBase !== 1 && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    Mengurangi stok {formatNumberID(requiredBase, { maximumFractionDigits: 4 })} {product.baseUnitLabel}.
                  </p>
                )}
                {insufficientStock && (
                  <p className="mt-1 text-xs font-medium text-danger-600 dark:text-danger-400">
                    ⚠ Stok tidak cukup. Tersedia hanya {formatQty(maxQtyInUnit)} {unit?.unitLabel}.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Batal
        </Button>
        <Button
          variant="brand"
          onClick={handleConfirm}
          disabled={!matchedTier || insufficientStock}
        >
          Tambah ke Keranjang
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return formatNumberID(n)
  return formatNumberID(n, { maximumFractionDigits: 4 })
}
