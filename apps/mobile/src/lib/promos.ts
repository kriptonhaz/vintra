/**
 * Auto-promo preview for the mobile cart.
 *
 * `listActivePromotions` returns every active non-code promo with its
 * resolved item + category targets. The cart matches each line against
 * those targets and picks the highest-discount candidate — mirroring
 * `pickAutoPromoForLine` on the web (cashier-cart.tsx:697) and the
 * createSale promo-resolution chain. Server is the source of truth on
 * checkout; this hook is purely a UI preview so the cashier can quote
 * the discounted price.
 *
 * The math is small + stable, so we duplicate it here rather than spin
 * up a per-keystroke server preview endpoint.
 */
import { useQuery } from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface ActiveAutoPromo {
  id: string
  name: string
  triggerType: string
  discountType: string
  discountValue: number
  maxDiscountAmount: number | null
  minCartTotal: number | null
  startsAt: string | null
  endsAt: string | null
  itemIds: string[]
  categoryIds: string[]
}

export function useActivePromotions() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'active-promotions', tenantId],
    enabled: !!tenantId,
    staleTime: 60 * 1000,
    queryFn: () =>
      callServerFn<ActiveAutoPromo[]>(
        'listActivePromotions',
        {},
        { tenantId },
      ),
  })
}

/**
 * Compute the Rupiah discount a single promo would apply to a given
 * line subtotal. Mirrors `computeAutoPromoAmount` on the web exactly —
 * percent rounds, fixed caps at base, maxDiscountAmount caps both.
 */
export function computeAutoPromoAmount(
  promo: ActiveAutoPromo,
  base: number,
): number {
  if (base <= 0 || promo.discountValue <= 0) return 0
  let amount =
    promo.discountType === 'percent'
      ? Math.round((base * promo.discountValue) / 100)
      : Math.min(promo.discountValue, base)
  if (promo.maxDiscountAmount != null && amount > promo.maxDiscountAmount) {
    amount = promo.maxDiscountAmount
  }
  if (amount > base) amount = base
  return amount
}

/**
 * Per-line auto-promo resolver. Collects every promo whose itemIds
 * includes this line's item OR whose categoryIds includes this line's
 * category, then picks the candidate with the highest computed
 * discount. Same tie-break as the web + server so the preview agrees
 * with what createSale will persist.
 */
export function pickAutoPromoForLine(
  itemId: string | null,
  categoryId: string | null,
  base: number,
  promos: readonly ActiveAutoPromo[],
): { promo: ActiveAutoPromo; amount: number } | null {
  if (!itemId || base <= 0 || promos.length === 0) return null
  let best: { promo: ActiveAutoPromo; amount: number } | null = null
  for (const p of promos) {
    const matchItem = p.itemIds.includes(itemId)
    const matchCategory =
      categoryId != null && p.categoryIds.includes(categoryId)
    if (!matchItem && !matchCategory) continue
    const amount = computeAutoPromoAmount(p, base)
    if (amount > 0 && (!best || amount > best.amount)) {
      best = { promo: p, amount }
    }
  }
  return best
}

/**
 * Compute the full auto-promo breakdown for a cart. Returns the
 * aggregated discount per promo (the cashier wants to see "Promo Buy 1
 * Get 1: −Rp 5.000" rows, not per-line entries) and the total auto
 * discount to subtract from the gross subtotal.
 */
export function computeAutoPromos(
  lines: ReadonlyArray<{
    itemId: string
    categoryId: string | null
    qty: number
    unitPrice: number
  }>,
  promos: readonly ActiveAutoPromo[],
): {
  totalDiscount: number
  perPromo: Array<{ id: string; name: string; amount: number }>
} {
  if (promos.length === 0 || lines.length === 0) {
    return { totalDiscount: 0, perPromo: [] }
  }
  const perPromoMap = new Map<string, { name: string; amount: number }>()
  let total = 0
  for (const l of lines) {
    const base = l.qty * l.unitPrice
    const best = pickAutoPromoForLine(l.itemId, l.categoryId, base, promos)
    if (!best) continue
    const prev = perPromoMap.get(best.promo.id)
    perPromoMap.set(best.promo.id, {
      name: best.promo.name,
      amount: (prev?.amount ?? 0) + best.amount,
    })
    total += best.amount
  }
  return {
    totalDiscount: total,
    perPromo: Array.from(perPromoMap.entries()).map(([id, v]) => ({
      id,
      name: v.name,
      amount: v.amount,
    })),
  }
}
