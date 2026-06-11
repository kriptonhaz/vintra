import * as React from 'react'
import { Plus, Minus, Trash2, ShoppingCart, UserCircle, Tag, User, X } from 'lucide-react'
import { CustomerPickerModal, type PickedCustomer } from './customer-picker-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/currency-input'
import { formatRupiah } from '@/lib/currency'
import { cn, formatNumberID } from '@/lib/utils' // JUR-137
import type { POSFeatureFlag } from '@vintra/shared'

export interface CartLine {
  rowKey: string
  itemId: string | null
  /** Inventory category for this item — drives `auto_category` promo
   *  matching client-side. Null for ad-hoc lines or uncategorised items. */
  categoryId?: string | null
  /** Sold-unit id. Null for ad-hoc lines. */
  unitId: string | null
  name: string
  unitPrice: number
  qty: number
  isAdhoc: boolean
  /** Sold-unit label for display ("gram"/"kg"). Undefined for ad-hoc. */
  unitLabel?: string
  /** How many base units = 1 sold unit. Used for stock conversion. */
  ratioToBase?: number
  /** Did the matched tier have minQty > 1 (= bulk pricing applied). */
  isBulk?: boolean
  /** Tier ladder for this (item, unit) — kept on the line so stepping
   *  qty can re-tier client-side. Server still validates on submit. */
  tiers?: Array<{ minQty: number; unitPrice: number }>
  /**
   * Snapshot of total stock-in-base for this item at add time. Cart
   * uses it to compute the qty cap so stepping up can't exceed what's
   * physically available (minus other cart lines for the same item).
   */
  stockInBase?: number
  /**
   * Service-mode flag — true when the line's item links to a recipe-
   * backed HPP product. Recipe items have no own stock balance; the
   * qty cap stays unbounded and the cart skips the stock check.
   */
  recipeBacked?: boolean
  /**
   * Per-line discount (JUR-7). Optional. When set, this line's
   * subtotal becomes `qty × unitPrice - <computed amount>`. Stored
   * client-side as user-input (type + value); server recomputes the
   * actual amount on createSale to keep the math authoritative.
   */
  lineDiscount?: { type: 'fixed' | 'percent'; value: number } | null
}

export interface CashierCartHandle {
  reset: () => void
}

interface LoyaltyState {
  earnRate: number
  redeemRate: number
  /** null while the balance query is loading. */
  pointsBalance: number | null
  /** Currently-staged redemption (cashier scratchpad). */
  redeemPoints: number
  onRedeemPointsChange: (n: number) => void
}

interface Props {
  lines: CartLine[]
  onUpdateLine: (rowKey: string, patch: Partial<CartLine>) => void
  onRemoveLine: (rowKey: string) => void
  onAddAdhoc: () => void
  onCheckout: () => void
  /**
   * Active auto-promos (post-window filter, with item / category
   * targets) so the cart can preview the same discount createSale will
   * apply at checkout. Optional — omit to skip the preview.
   */
  activeAutoPromos?: readonly ActiveAutoPromo[]
  features: ReadonlyArray<POSFeatureFlag>
  /**
   * Active tax stack from settings. Each row applies independently to
   * the post-discount, post-promo, post-redeem subtotal; the cart
   * breakdown renders a row per entry. Empty array hides the tax
   * section entirely (Free tenants who never set anything up).
   */
  taxes: ReadonlyArray<{ label: string; percent: number }>
  /** Resolved customer-row id (when picker matched/created an entity).
   *  Null = walk-in or pre-Toko tenant where customer DB is off. */
  customerId: string | null
  customerName: string
  customerPhone: string
  onCustomerAttach: (c: PickedCustomer) => void
  onCustomerDetach: () => void
  /**
   * Loyalty state — null when feature is off, tier doesn't include
   * loyalty_points, or no customer is attached. The cart only
   * renders the redeem affordance when this prop is supplied.
   */
  loyalty: LoyaltyState | null
  discountType: 'fixed' | 'percent' | null
  discountValue: number
  onDiscountTypeChange: (t: 'fixed' | 'percent' | null) => void
  onDiscountValueChange: (v: number) => void
  /**
   * Promo code entered by cashier (JUR-9). Tier-gated on
   * `promo_codes`. Server validates on createSale and rolls back the
   * sale if the code is invalid (caps reached, expired, etc.) — the
   * cashier sees the error in the existing onError toast.
   */
  promoCode: string
  onPromoCodeChange: (v: string) => void
  /**
   * Server-validated promo discount in Rp (parent runs the live
   * validatePromoCode query). 0 when the code is empty/invalid. Drives
   * both the breakdown "Promo" row AND the post-promo total — without
   * this, the cart would show the pre-promo total even though the
   * server applies the discount, causing the cashier to over-collect
   * cash.
   */
  promoAmount?: number
  /**
   * Cashier-typed reason for an invalid promo code. Renders inline
   * under the input so the cashier knows why no discount was applied
   * before they tap Bayar. Empty when the code is empty or valid.
   */
  promoError?: string | null
  /**
   * Resolved promo display name when valid (e.g. "Diskon 20% akhir
   * pekan"). Null when the code is empty or invalid. Drives the
   * breakdown row label so the cashier sees which promo was applied.
   */
  promoLabel?: string | null
}

/**
 * For a given line, compute the max qty the cashier can step to
 * without exceeding stock. Subtracts qty already committed in OTHER
 * lines of the same item (cross-unit, normalised to base) so the cap
 * stays accurate when an item is split across multiple unit lines.
 *
 * Returns Infinity for ad-hoc lines (no inventory backing).
 */
function maxQtyForLine(line: CartLine, allLines: CartLine[]): number {
  if (line.isAdhoc || line.itemId == null) return Infinity
  // Service-mode (recipe-backed) items have no own stock — server
  // walks the BOM to deduct ingredients. Skip the stock cap so the
  // cashier can ring as many cups as the bahan supports.
  if (line.recipeBacked) return Infinity
  if (line.stockInBase == null || line.ratioToBase == null) return Infinity
  const reservedByOthers = allLines
    .filter(
      (l) =>
        l.rowKey !== line.rowKey &&
        l.itemId === line.itemId &&
        !l.isAdhoc &&
        l.ratioToBase != null,
    )
    .reduce((sum, l) => sum + l.qty * (l.ratioToBase ?? 0), 0)
  const available = Math.max(0, line.stockInBase - reservedByOthers)
  return line.ratioToBase > 0 ? available / line.ratioToBase : 0
}

export function CashierCart({
  lines,
  onUpdateLine,
  onRemoveLine,
  onAddAdhoc,
  onCheckout,
  activeAutoPromos,
  features,
  taxes,
  customerId: _customerId,
  customerName,
  customerPhone,
  onCustomerAttach,
  onCustomerDetach,
  loyalty,
  discountType,
  discountValue,
  onDiscountTypeChange,
  onDiscountValueChange,
  promoCode,
  onPromoCodeChange,
  promoAmount = 0,
  promoError = null,
  promoLabel = null,
}: Props) {
  const canDiscount = features.includes('sale_discount')
  const canCustomer = features.includes('customer_capture')
  const canLineDiscount = features.includes('line_discount')

  // Customer picker modal state lives here (not in CustomerSlot) so the
  // header "Pelanggan" button and the attached-chip "Ubah" affordance
  // both open the same modal.
  const isCustomerAttached = customerName.trim().length > 0
  const [customerPickerOpen, setCustomerPickerOpen] = React.useState(false)

  // Single source of truth: same helper the parent route uses for the
  // payment modal + success modal totals, so the cart breakdown and
  // the Bayar button can never disagree.
  const totals = computeCartTotals({
    lines,
    discountType,
    discountValue: canDiscount ? discountValue : 0,
    promoAmount,
    redeemPoints: loyalty?.redeemPoints ?? 0,
    redeemRate: loyalty?.redeemRate ?? 0,
    taxes,
    activeAutoPromos,
  })
  const {
    subtotalGross,
    subtotal,
    discountAmount,
    promoAmount: appliedPromoAmount,
    redeemPoints: stagedRedeemPoints,
    redeemAmount: stagedRedeemAmount,
    taxLines: cartTaxLines,
    total,
    autoPromosApplied,
  } = totals

  return (
    // `min-h-0` is required so the inner `flex-1 overflow-y-auto`
    // actually scrolls — without it, the flex item refuses to shrink
    // below its content's natural height and the scroll never engages.
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — sticky top */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex min-w-0 items-center gap-2">
          <ShoppingCart className="h-5 w-5 shrink-0 text-brand-600" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            Keranjang
          </h3>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            {lines.length} item
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          {/* Desktop: attached customer rides in the header beside Item
              Lain. On mobile this is hidden and the details move to the
              full-width card below (the header chip truncated the name
              to "Q…" on a narrow pane). */}
          {canCustomer && isCustomerAttached && (
            <div className="hidden min-w-0 items-center gap-1 rounded-lg bg-brand-50 py-1 pl-2 pr-1 ring-1 ring-brand-200 md:flex dark:bg-brand-900/20 dark:ring-brand-800">
              <button
                type="button"
                onClick={() => setCustomerPickerOpen(true)}
                className="flex min-w-0 items-center gap-1.5 text-left"
              >
                <UserCircle className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-tight text-gray-900 dark:text-gray-100">
                    {customerName}
                  </p>
                  {customerPhone && (
                    <p className="truncate text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                      {customerPhone}
                    </p>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={onCustomerDetach}
                aria-label="Lepaskan pelanggan"
                className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-white hover:text-danger-600 dark:hover:bg-gray-800"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {canCustomer && !isCustomerAttached && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCustomerPickerOpen(true)}
            >
              <UserCircle className="h-4 w-4" /> Pelanggan
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={onAddAdhoc}
          >
            <Plus className="h-4 w-4" /> Item Lain
          </Button>
        </div>
      </div>

      {/* Tablet + desktop: the customer chip is in the header, so only
          the loyalty card sits here (when the tenant has loyalty on). */}
      {canCustomer && isCustomerAttached && loyalty && (
        <div className="hidden shrink-0 border-b border-gray-200 py-2 md:block dark:border-gray-700">
          <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-800 dark:bg-brand-900/20">
            <LoyaltyRedeemContent
              loyalty={loyalty}
              postDiscountSubtotal={Math.max(
                0,
                subtotal - discountAmount - appliedPromoAmount,
              )}
            />
          </div>
        </div>
      )}

      {/* Phones only: full-width customer card (name + phone, plus the
          loyalty balance + redeem input when on). Replaces the header
          chip whose name truncated to "Q…" on a narrow pane. */}
      {canCustomer && isCustomerAttached && (
        <div className="shrink-0 border-b border-gray-200 py-2 md:hidden dark:border-gray-700">
          <CustomerCard
            customerName={customerName}
            customerPhone={customerPhone}
            onEdit={() => setCustomerPickerOpen(true)}
            onDetach={onCustomerDetach}
            loyalty={loyalty}
            postDiscountSubtotal={Math.max(
              0,
              subtotal - discountAmount - appliedPromoAmount,
            )}
          />
        </div>
      )}

      {/* Scrollable middle: lines + discount + breakdown. */}
      <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 py-3">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-gray-500">
            <ShoppingCart className="mb-2 h-8 w-8 text-gray-300" />
            <p>Belum ada item. Pilih dari grid produk di kiri.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <CartLineRow
                key={line.rowKey}
                line={line}
                maxQty={maxQtyForLine(line, lines)}
                canLineDiscount={canLineDiscount}
                onUpdate={(patch) => onUpdateLine(line.rowKey, patch)}
                onRemove={() => onRemoveLine(line.rowKey)}
              />
            ))}
          </ul>
        )}

        {features.includes('promo_codes') && lines.length > 0 && (
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
            <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
              Kode promo (opsional)
            </p>
            <Input
              value={promoCode}
              onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
              placeholder="cth. HEMAT20"
            />
            {promoCode.trim() && appliedPromoAmount > 0 && (
              <p className="mt-1.5 text-xs text-success-600 dark:text-success-400">
                {promoLabel ?? `Promo "${promoCode}"`} aktif —
                potongan {formatRupiah(appliedPromoAmount)}
              </p>
            )}
            {promoCode.trim() && promoError && (
              <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-400">
                {promoError}
              </p>
            )}
          </div>
        )}

        {canDiscount && lines.length > 0 && (
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
            <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
              Diskon (opsional)
            </p>
            <div className="flex gap-2">
              <select
                value={discountType ?? ''}
                onChange={(e) =>
                  onDiscountTypeChange(
                    (e.target.value || null) as 'fixed' | 'percent' | null,
                  )
                }
                className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">—</option>
                <option value="percent">%</option>
                <option value="fixed">Rp</option>
              </select>
              {discountType === 'percent' ? (
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={discountValue || ''}
                  onChange={(e) =>
                    onDiscountValueChange(parseFloat(e.target.value) || 0)
                  }
                  placeholder="0"
                />
              ) : (
                <CurrencyInput
                  value={discountValue.toString()}
                  onChange={(v) => onDiscountValueChange(parseInt(v) || 0)}
                />
              )}
            </div>
          </div>
        )}

        {/* Subtotal + Tax breakdown — scrolls with everything else.
            The big TOTAL line + Bayar button live in the sticky
            footer so they're always visible. */}
        <div className="space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatRupiah(subtotalGross)} />
          {autoPromosApplied.map((ap) => (
            <Row
              key={ap.id}
              label={`Promo · ${ap.name}`}
              value={`-${formatRupiah(ap.amount)}`}
              accent="text-success-600"
            />
          ))}
          {discountAmount > 0 && (
            <Row
              label="Diskon"
              value={`-${formatRupiah(discountAmount)}`}
              accent="text-success-600"
            />
          )}
          {appliedPromoAmount > 0 && (
            <Row
              label={promoLabel ? `Promo · ${promoLabel}` : 'Promo'}
              value={`-${formatRupiah(appliedPromoAmount)}`}
              accent="text-success-600"
            />
          )}
          {stagedRedeemAmount > 0 && (
            <Row
              label={`Tukar poin (${formatNumberID(stagedRedeemPoints)})`}
              value={`-${formatRupiah(stagedRedeemAmount)}`}
              accent="text-brand-600"
            />
          )}
          {cartTaxLines.map((t) =>
            t.amount > 0 ? (
              <Row
                key={`${t.label}-${t.percent}`}
                label={t.percent > 0 ? `${t.label} ${t.percent}%` : t.label}
                value={formatRupiah(t.amount)}
              />
            ) : null,
          )}
        </div>
      </div>

      {/* Sticky footer — TOTAL + Bayar always visible regardless of
          how much the cashier has scrolled. */}
      <div className="shrink-0 space-y-3 border-t border-gray-200 pt-3 dark:border-gray-700">
        <Row label="TOTAL" value={formatRupiah(total)} bold big />
        <Button
          variant="brand"
          size="lg"
          className="w-full"
          disabled={lines.length === 0}
          onClick={onCheckout}
        >
          Bayar {formatRupiah(total)}
        </Button>
      </div>

      {canCustomer && (
        <CustomerPickerModal
          open={customerPickerOpen}
          initialPhone={customerPhone}
          initialName={customerName}
          onClose={() => setCustomerPickerOpen(false)}
          onSkip={() => {
            onCustomerDetach()
            setCustomerPickerOpen(false)
          }}
          onPick={(c) => {
            onCustomerAttach(c)
            setCustomerPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}

function formatCartQty(n: number): string {
  if (Number.isInteger(n)) return formatNumberID(n)
  return formatNumberID(n, { maximumFractionDigits: 4 })
}

/**
 * Sale-level discount math, factored out so the totals breakdown and
 * the loyalty redeem cap can both compute the same post-discount
 * subtotal. Mirrors the server-side calc in createSale exactly.
 */
function computeDiscountAmount(
  type: 'fixed' | 'percent' | null,
  value: number,
  subtotal: number,
): number {
  if (!type || value <= 0) return 0
  return type === 'percent'
    ? Math.round((subtotal * value) / 100)
    : Math.min(value, subtotal)
}

/**
 * Single-source-of-truth cart math. Both this component AND the parent
 * cashier route call this so the breakdown shown to the cashier and
 * the amount sent to PaymentModal / SaleSuccessModal can never drift.
 *
 * Order: line-discount → cart subtotal → sale-discount → promo →
 * loyalty redeem (capped to remaining) → tax → total. Mirrors
 * createSale exactly so the PaymentModal preview matches the row the
 * server persists.
 */
export function computeCartTotals(input: {
  lines: CartLine[]
  discountType: 'fixed' | 'percent' | null
  discountValue: number
  /** Server-validated promo amount (Rp). 0 when code empty/invalid. */
  promoAmount?: number
  redeemPoints?: number
  redeemRate?: number
  /**
   * Active tax stack. Each row applies independently to the same
   * post-discount, post-promo, post-redeem subtotal — no cumulative
   * stacking. Empty array = no tax line.
   */
  taxes: ReadonlyArray<{ label: string; percent: number }>
  /**
   * Tenant's active auto-promos with resolved item / category target
   * lists. When supplied, the per-line block matches each line against
   * its targets (highest-discount tie-break) and bakes the discount
   * into the subtotal — so the breakdown + Bayar button reflect what
   * createSale will charge. Omit to skip the preview (legacy callers).
   */
  activeAutoPromos?: readonly ActiveAutoPromo[]
}): {
  /** Gross subtotal — line totals after line-discount only. */
  subtotalGross: number
  /** Subtotal after baked-in auto-promo (= subtotalGross − Σ auto). */
  subtotal: number
  discountAmount: number
  promoAmount: number
  redeemPoints: number
  redeemAmount: number
  taxBase: number
  /** Per-tax breakdown for the cart UI + receipt preview. */
  taxLines: Array<{ label: string; percent: number; amount: number }>
  /** Sum of every tax line. */
  taxAmount: number
  total: number
  /**
   * Per-promo aggregate of the line-level auto-promo discount that was
   * baked into `subtotal`. Drives the cart breakdown rows ("Promo · X"
   * −Rp Y) so the cashier can tell the customer which promo applied.
   */
  autoPromosApplied: Array<{ id: string; name: string; amount: number }>
} {
  const autos = input.activeAutoPromos ?? []
  const perPromoAmount = new Map<string, { name: string; amount: number }>()
  // Subtotal is the *gross* (line-discount only). Auto-promos sit as
  // their own breakdown rows below, so the cashier can tell the
  // customer "Subtotal Rp 6.000 → Promo Rp 3.000 → bayar Rp 3.000".
  const subtotalGross = input.lines.reduce(
    (sum, l) => sum + lineNetSubtotal(l),
    0,
  )
  let autoPromoTotal = 0
  if (autos.length > 0) {
    for (const l of input.lines) {
      const afterLine = lineNetSubtotal(l)
      const best = pickAutoPromoForLine(
        l.itemId,
        l.categoryId ?? null,
        afterLine,
        autos,
      )
      if (!best) continue
      const prev = perPromoAmount.get(best.promo.id)
      perPromoAmount.set(best.promo.id, {
        name: best.promo.name,
        amount: (prev?.amount ?? 0) + best.amount,
      })
      autoPromoTotal += best.amount
    }
  }
  const autoPromosApplied = Array.from(perPromoAmount.entries()).map(
    ([id, v]) => ({ id, name: v.name, amount: v.amount }),
  )
  // Downstream calc (sale-discount, code-promo, redeem, tax) operates
  // on the post-auto-promo base.
  const subtotal = Math.max(0, subtotalGross - autoPromoTotal)
  const discountAmount = computeDiscountAmount(
    input.discountType,
    input.discountValue,
    subtotal,
  )
  // Promo applies on the post-discount base. We cap to that base so a
  // server reconciliation drift can't drop the total below zero in the
  // preview.
  const postDiscount = Math.max(0, subtotal - discountAmount)
  const promoAmount = Math.max(0, Math.min(input.promoAmount ?? 0, postDiscount))
  const postPromo = Math.max(0, postDiscount - promoAmount)
  // Loyalty redeem applies AFTER promo, capped to whatever's left.
  // Whole-point math: floor cappedAmount/rate, then × rate so the row
  // total never exceeds the visible "tukar X poin" amount.
  const requestedRedeemPoints = Math.max(0, input.redeemPoints ?? 0)
  const redeemRate = input.redeemRate ?? 0
  let redeemPoints = 0
  let redeemAmount = 0
  if (requestedRedeemPoints > 0 && redeemRate > 0) {
    const cappedAmount = Math.min(requestedRedeemPoints * redeemRate, postPromo)
    redeemPoints = Math.floor(cappedAmount / redeemRate)
    redeemAmount = redeemPoints * redeemRate
  }
  const taxBase = Math.max(0, postPromo - redeemAmount)
  const taxLines = input.taxes.map((t) => ({
    label: t.label,
    percent: t.percent,
    amount: Math.round((taxBase * t.percent) / 100),
  }))
  const taxAmount = taxLines.reduce((sum, l) => sum + l.amount, 0)
  return {
    subtotalGross,
    subtotal,
    discountAmount,
    promoAmount,
    redeemPoints,
    redeemAmount,
    taxBase,
    taxLines,
    taxAmount,
    total: taxBase + taxAmount,
    autoPromosApplied,
  }
}

/**
 * Active auto-promo shape returned by `listActivePromotions`. Carries
 * the resolved item + category targets so the client can match per
 * line without an extra round-trip. Mirrors the server's row shape.
 */
export interface ActiveAutoPromo {
  id: string
  name: string
  /** 'code' | 'auto_product' | 'auto_products' | 'auto_category' | 'auto_cart'. */
  triggerType: string
  discountType: string
  discountValue: number
  maxDiscountAmount: number | null
  minCartTotal: number | null
  startsAt: Date | string | null
  endsAt: Date | string | null
  itemIds: string[]
  categoryIds: string[]
}

/**
 * Auto-promo amount math. Mirrors `computePromoAmount` in the server's
 * `promotions.ts` exactly so the preview agrees with what createSale
 * will persist.
 */
function computeAutoPromoAmount(promo: ActiveAutoPromo, base: number): number {
  if (base <= 0 || promo.discountValue <= 0) return 0
  let amount =
    promo.discountType === 'percent'
      ? Math.round((base * promo.discountValue) / 100)
      : Math.min(promo.discountValue, base)
  if (
    promo.maxDiscountAmount != null &&
    amount > promo.maxDiscountAmount
  ) {
    amount = promo.maxDiscountAmount
  }
  if (amount > base) amount = base
  return amount
}

/**
 * Per-line auto-promo resolver. Mirrors `pickAutoPromoForLine` on the
 * server — collects every promo whose itemIds includes this line's item
 * OR whose categoryIds includes this line's category, then picks the
 * candidate with the highest computed discount (consistent tie-break
 * when more than one promo matches).
 */
function pickAutoPromoForLine(
  itemId: string | null,
  categoryId: string | null,
  base: number,
  promos: readonly ActiveAutoPromo[],
): { promo: ActiveAutoPromo; amount: number } | null {
  if (!itemId || base <= 0 || promos.length === 0) return null
  let best: { promo: ActiveAutoPromo; amount: number } | null = null
  for (const p of promos) {
    const matchItem = p.itemIds.includes(itemId)
    const matchCategory = categoryId != null && p.categoryIds.includes(categoryId)
    if (!matchItem && !matchCategory) continue
    const amount = computeAutoPromoAmount(p, base)
    if (amount > 0 && (!best || amount > best.amount)) {
      best = { promo: p, amount }
    }
  }
  return best
}

/**
 * Per-line discount math (JUR-7). Capped at the gross line total so a
 * line can't go negative. Mirrors the server-side computeLineDiscount
 * exactly so client preview agrees with what createSale persists.
 */
function lineDiscountAmount(line: CartLine): number {
  const gross = line.qty * line.unitPrice
  if (!line.lineDiscount || line.lineDiscount.value <= 0) return 0
  return line.lineDiscount.type === 'percent'
    ? Math.round((gross * line.lineDiscount.value) / 100)
    : Math.min(line.lineDiscount.value, gross)
}

/** Per-line subtotal AFTER line-discount. */
function lineNetSubtotal(line: CartLine): number {
  return Math.max(0, line.qty * line.unitPrice - lineDiscountAmount(line))
}

/**
 * Attached-customer card. Shows the picked customer's name + phone with
 * full width (the header chip was too cramped on a narrow cart pane —
 * the name truncated to "Q…"). When the tenant has loyalty on, the
 * points balance + redeem input sit in the same card under a divider.
 * Tap the name/"Ubah" to re-open the picker, ✕ to detach.
 */
function CustomerCard({
  customerName,
  customerPhone,
  onEdit,
  onDetach,
  loyalty,
  postDiscountSubtotal,
}: {
  customerName: string
  customerPhone: string
  onEdit: () => void
  onDetach: () => void
  loyalty: LoyaltyState | null
  postDiscountSubtotal: number
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-800 dark:bg-brand-900/20">
      <div className="flex items-center gap-2">
        <UserCircle className="h-6 w-6 shrink-0 text-brand-700 dark:text-brand-300" />
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            {customerName}
          </p>
          {customerPhone && (
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {customerPhone}
            </p>
          )}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-brand-700 hover:bg-white/60 dark:text-brand-300 dark:hover:bg-gray-800/60"
        >
          Ubah
        </button>
        <button
          type="button"
          onClick={onDetach}
          aria-label="Lepaskan pelanggan"
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-white hover:text-danger-600 dark:hover:bg-gray-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {loyalty && (
        <>
          <div className="border-t border-brand-200/70 dark:border-brand-800/60" />
          <LoyaltyRedeemContent
            loyalty={loyalty}
            postDiscountSubtotal={postDiscountSubtotal}
          />
        </>
      )}
    </div>
  )
}

/**
 * Loyalty redemption content — lives inside CustomerCard. Renders the
 * customer's current balance + a points input. The cashier sees the
 * rupiah equivalent next to whatever they type, and the input caps
 * against the post-discount subtotal so over-redeem is impossible
 * client-side. (Server still re-validates.)
 */
function LoyaltyRedeemContent({
  loyalty,
  postDiscountSubtotal,
}: {
  loyalty: LoyaltyState
  postDiscountSubtotal: number
}) {
  const balance = loyalty.pointsBalance
  // Max redeemable: cashier can spend up to their balance, capped by
  // however many points fit into the post-discount subtotal.
  const maxFromCart =
    loyalty.redeemRate > 0
      ? Math.floor(postDiscountSubtotal / loyalty.redeemRate)
      : 0
  const maxRedeemable =
    balance == null ? 0 : Math.max(0, Math.min(balance, maxFromCart))
  const stagedAmount = loyalty.redeemPoints * loyalty.redeemRate

  // Loading + zero-balance states. Same row container so the cart
  // doesn't reflow when the query resolves.
  if (balance == null) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Memuat saldo poin…
      </p>
    )
  }
  if (balance <= 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Pelanggan belum punya poin yang bisa ditukar.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-brand-800 dark:text-brand-300">
          Saldo poin: {formatNumberID(balance)}
          <span className="ml-1 text-brand-700/70 dark:text-brand-400/70">
            (≈ {formatRupiah(balance * loyalty.redeemRate)})
          </span>
        </p>
        {loyalty.redeemPoints > 0 && (
          <button
            type="button"
            onClick={() => loyalty.onRedeemPointsChange(0)}
            className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            Hapus
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={maxRedeemable}
          inputMode="numeric"
          value={loyalty.redeemPoints || ''}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10)
            const v = Number.isNaN(raw) ? 0 : Math.max(0, raw)
            loyalty.onRedeemPointsChange(Math.min(v, maxRedeemable))
          }}
          placeholder="0"
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => loyalty.onRedeemPointsChange(maxRedeemable)}
          disabled={maxRedeemable === 0}
        >
          Tukar maks
        </Button>
      </div>
      {loyalty.redeemPoints > 0 && (
        <p className="text-xs text-brand-700 dark:text-brand-400">
          Tukar {formatNumberID(loyalty.redeemPoints)} poin →
          potongan {formatRupiah(stagedAmount)}
        </p>
      )}
    </div>
  )
}

/**
 * Per-line cart row, factored out so each line keeps its own
 * `qtyInput` string state. That string mirrors `line.qty` but is
 * allowed to be empty/partial mid-edit ("" / "0." / "1.5") so the
 * cashier can backspace + re-type without React snapping the value
 * back to "1" mid-keystroke. We only push back to parent state when
 * the string parses to a valid positive number.
 */
function CartLineRow({
  line,
  maxQty,
  canLineDiscount,
  onUpdate,
  onRemove,
}: {
  line: CartLine
  maxQty: number
  canLineDiscount: boolean
  onUpdate: (patch: Partial<CartLine>) => void
  onRemove: () => void
}) {
  const atCap = Number.isFinite(maxQty) && line.qty >= maxQty
  const [qtyInput, setQtyInput] = React.useState<string>(String(line.qty))
  // Inline form open state — collapses by default so the row stays
  // compact. Re-opens whenever the cashier taps the % affordance,
  // closes on blur / apply / hapus.
  const [discountFormOpen, setDiscountFormOpen] = React.useState(false)
  const lineDiscAmount = lineDiscountAmount(line)
  const grossLine = line.qty * line.unitPrice
  const netLine = Math.max(0, grossLine - lineDiscAmount)

  // Re-sync the input when the parent's qty changes from outside our
  // typing path (stepper button, modal merge, tier re-match). We only
  // overwrite if the user isn't mid-edit on a different value.
  React.useEffect(() => {
    const parsed = parseFloat(qtyInput)
    if (Number.isNaN(parsed) || parsed !== line.qty) {
      setQtyInput(String(line.qty))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.qty])

  function commit(next: number) {
    const safe = next < 0.0001 ? 0.0001 : next
    const clamped = Number.isFinite(maxQty) ? Math.min(safe, maxQty) : safe
    onUpdate({ qty: clamped })
    setQtyInput(String(clamped))
  }

  function handleChange(raw: string) {
    setQtyInput(raw)
    if (raw === '') return
    const v = parseFloat(raw)
    if (Number.isNaN(v) || v <= 0) return
    const clamped = Number.isFinite(maxQty) ? Math.min(v, maxQty) : v
    onUpdate({ qty: clamped })
  }

  function handleBlur() {
    if (qtyInput === '' || Number.isNaN(parseFloat(qtyInput))) {
      commit(1)
    } else {
      setQtyInput(String(line.qty))
    }
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            {line.name}
            {line.isAdhoc && (
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                ad-hoc
              </span>
            )}
          </p>
          {line.isBulk && (
            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-medium text-accent-700 dark:bg-accent-900/30 dark:text-accent-400">
              <Tag className="h-2.5 w-2.5" />
              Harga Grosir
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => commit(line.qty - 1)}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 md:h-9 md:w-9 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:active:bg-gray-600"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            value={qtyInput}
            min={0.0001}
            max={Number.isFinite(maxQty) ? maxQty : undefined}
            step="any"
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            className="h-11 w-16 rounded-md border border-gray-200 bg-white px-2 text-center text-base text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 md:h-9 md:w-14 md:text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <button
            type="button"
            disabled={atCap}
            onClick={() => commit(line.qty + 1)}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white md:h-9 md:w-9 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:active:bg-gray-600 dark:disabled:hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {canLineDiscount && (
            <button
              type="button"
              onClick={() => setDiscountFormOpen((v) => !v)}
              aria-label="Diskon item"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md border text-xs font-bold transition-colors',
                lineDiscAmount > 0
                  ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700',
              )}
              title="Diskon untuk item ini"
            >
              %
            </button>
          )}
          <div className="text-right">
            {lineDiscAmount > 0 && (
              <p className="text-xs text-gray-400 line-through">
                {formatRupiah(grossLine)}
              </p>
            )}
            <p className="text-base font-semibold text-gray-900 md:text-sm dark:text-gray-100">
              {formatRupiah(netLine)}
            </p>
          </div>
        </div>
      </div>
      <p className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span>
          @ {formatRupiah(line.unitPrice)}
          {line.unitLabel && ` / ${line.unitLabel}`}
        </span>
        {Number.isFinite(maxQty) && (
          <span
            className={atCap ? 'font-medium text-warning-700' : ''}
            title="Maksimum berdasarkan stok tersedia"
          >
            · maks {formatCartQty(maxQty)} {line.unitLabel ?? ''}
          </span>
        )}
      </p>
      {/* Per-line discount inline form (JUR-7). Tier-gated render at
          parent. Collapsed by default; opens via the % button. */}
      {canLineDiscount && discountFormOpen && (
        <LineDiscountForm
          line={line}
          onApply={(d) => {
            onUpdate({ lineDiscount: d })
            setDiscountFormOpen(false)
          }}
          onClear={() => {
            onUpdate({ lineDiscount: null })
            setDiscountFormOpen(false)
          }}
          onClose={() => setDiscountFormOpen(false)}
        />
      )}
      {!discountFormOpen && lineDiscAmount > 0 && (
        <p className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-300">
          Diskon item: −{formatRupiah(lineDiscAmount)}{' '}
          {line.lineDiscount?.type === 'percent' &&
            `(${line.lineDiscount.value}%)`}
        </p>
      )}
    </li>
  )
}

/**
 * Inline mini-form for per-line discount entry. Tap the % affordance
 * on a cart line to reveal it. Type radio (Rp / %) + numeric input
 * + Apply / Hapus / Tutup. Stored on the line as
 * `lineDiscount: { type, value }`; server recomputes the actual Rp
 * amount on submit.
 */
function LineDiscountForm({
  line,
  onApply,
  onClear,
  onClose,
}: {
  line: CartLine
  onApply: (d: { type: 'fixed' | 'percent'; value: number }) => void
  onClear: () => void
  onClose: () => void
}) {
  const [type, setType] = React.useState<'fixed' | 'percent'>(
    line.lineDiscount?.type ?? 'percent',
  )
  const [value, setValue] = React.useState<string>(
    line.lineDiscount && line.lineDiscount.value > 0
      ? String(line.lineDiscount.value)
      : '',
  )
  const numValue = parseFloat(value)
  const isValid = !Number.isNaN(numValue) && numValue > 0

  return (
    <div className="mt-2 rounded-md border border-brand-200 bg-brand-50/40 p-2.5 dark:border-brand-800 dark:bg-brand-900/10">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setType('percent')}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              type === 'percent'
                ? 'bg-brand-600 text-white'
                : 'text-gray-600 dark:text-gray-300',
            )}
          >
            %
          </button>
          <button
            type="button"
            onClick={() => setType('fixed')}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              type === 'fixed'
                ? 'bg-brand-600 text-white'
                : 'text-gray-600 dark:text-gray-300',
            )}
          >
            Rp
          </button>
        </div>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={0}
          max={type === 'percent' ? 100 : undefined}
          step="any"
          autoFocus
          placeholder={type === 'percent' ? '10' : '5000'}
          className="h-9 flex-1 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {line.lineDiscount && line.lineDiscount.value > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-danger-600 hover:underline dark:text-danger-400"
          >
            Hapus
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Tutup
        </button>
        <button
          type="button"
          onClick={() => isValid && onApply({ type, value: numValue })}
          disabled={!isValid}
          className="rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Terapkan
        </button>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
  big,
  accent,
}: {
  label: string
  value: string
  bold?: boolean
  big?: boolean
  accent?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={cn(
          'text-gray-600 dark:text-gray-400',
          bold && 'font-semibold text-gray-900 dark:text-gray-100',
          big && 'text-base',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          accent ?? 'text-gray-900 dark:text-gray-100',
          bold && 'font-bold',
          big && 'text-lg',
        )}
      >
        {value}
      </span>
    </div>
  )
}
