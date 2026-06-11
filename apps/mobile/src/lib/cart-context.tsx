/**
 * Cart state for the POS tab. In-memory only (matches web POS — no
 * persistence; a force-quit drops the cart, which is desired since
 * the cashier shouldn't accidentally ring stale items the next day).
 *
 * Why a context vs useState: the POS tab is one screen but checkout
 * lives on a separate route. Both need to read + mutate the same
 * cart without prop-drilling or URL-encoding line items.
 *
 * Cart math is computed on read (useMemo'd in the consumer) since
 * line counts stay small (warung sales rarely > 20 lines). No need
 * for incremental subtotals.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { PosProduct, PosUnit, SaleLine } from './pos'
import { pickDefaultPricing } from './pos'
import { useAuth } from './auth-context'

/**
 * In-cart line. Carries the display fields needed for the cart
 * sheet (name, unit label) so we don't have to keep the full
 * product list available during checkout.
 */
export interface CartLine {
  itemId: string
  unitId: string
  unitLabel: string
  name: string
  qty: number
  unitPrice: number
  /** Carried so the cart can match category-scoped auto-promos. */
  categoryId: string | null
}

/**
 * Customer attached to the current cart. Set by the picker sheet on
 * checkout; cleared whenever the cart is cleared (after a successful
 * sale, on user logout, etc.).
 */
export interface CartCustomer {
  id: string
  name: string
  phone: string | null
}

interface CartContextValue {
  lines: CartLine[]
  itemCount: number // sum of qty across lines, for the badge
  subtotal: number
  addProduct: (product: PosProduct) => void
  setQty: (itemId: string, unitId: string, qty: number) => void
  removeLine: (itemId: string, unitId: string) => void
  clear: () => void
  /** Snapshot the cart in the shape the createSale server fn wants. */
  toSaleLines: () => SaleLine[]
  // ─── Customer + loyalty/stamps attached to this cart ──────────────
  customer: CartCustomer | null
  setCustomer: (c: CartCustomer | null) => void
  /** Points the customer chose to redeem on this sale. */
  redeemPoints: number
  setRedeemPoints: (n: number) => void
  /** Stamp program ids the customer chose to redeem rewards from. */
  stampRedemptions: string[]
  toggleStampRedemption: (programId: string) => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [customer, setCustomerState] = useState<CartCustomer | null>(null)
  const [redeemPoints, setRedeemPointsState] = useState(0)
  const [stampRedemptions, setStampRedemptions] = useState<string[]>([])
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Drop the cart whenever the account changes (login as a different user
  // or logout) so one user's in-progress sale never carries into another's
  // session. Same-user token refreshes keep the same id → no spurious wipe.
  useEffect(() => {
    setLines([])
    setCustomerState(null)
    setRedeemPointsState(0)
    setStampRedemptions([])
  }, [userId])

  const addProduct = useCallback((product: PosProduct) => {
    const pricing = pickDefaultPricing(product)
    if (!pricing) return
    const { unit, tier } = pricing
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.itemId === product.id && l.unitId === unit.unitId,
      )
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, qty: l.qty + 1 } : l,
        )
      }
      return [
        ...prev,
        {
          itemId: product.id,
          unitId: unit.unitId,
          unitLabel: unit.unitLabel,
          name: product.name,
          qty: 1,
          unitPrice: tier.unitPrice,
          categoryId: product.categoryId,
        },
      ]
    })
  }, [])

  const setQty = useCallback(
    (itemId: string, unitId: string, qty: number) => {
      setLines((prev) => {
        if (qty <= 0) {
          return prev.filter(
            (l) => !(l.itemId === itemId && l.unitId === unitId),
          )
        }
        return prev.map((l) =>
          l.itemId === itemId && l.unitId === unitId ? { ...l, qty } : l,
        )
      })
    },
    [],
  )

  const removeLine = useCallback((itemId: string, unitId: string) => {
    setLines((prev) =>
      prev.filter((l) => !(l.itemId === itemId && l.unitId === unitId)),
    )
  }, [])

  const clear = useCallback(() => {
    setLines([])
    setCustomerState(null)
    setRedeemPointsState(0)
    setStampRedemptions([])
  }, [])

  // Detaching the customer means any loyalty / stamp choices they made
  // are no longer valid — server would reject them anyway. Clear both
  // so the checkout UI doesn't show stale redemption state.
  const setCustomer = useCallback((c: CartCustomer | null) => {
    setCustomerState(c)
    if (!c) {
      setRedeemPointsState(0)
      setStampRedemptions([])
    }
  }, [])

  const setRedeemPoints = useCallback(
    (n: number) => setRedeemPointsState(Math.max(0, Math.floor(n))),
    [],
  )

  const toggleStampRedemption = useCallback((programId: string) => {
    setStampRedemptions((prev) =>
      prev.includes(programId)
        ? prev.filter((id) => id !== programId)
        : [...prev, programId],
    )
  }, [])

  const itemCount = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty, 0),
    [lines],
  )
  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0),
    [lines],
  )

  const toSaleLines = useCallback(
    (): SaleLine[] =>
      lines.map((l) => ({
        itemId: l.itemId,
        unitId: l.unitId,
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
    [lines],
  )

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      itemCount,
      subtotal,
      addProduct,
      setQty,
      removeLine,
      clear,
      toSaleLines,
      customer,
      setCustomer,
      redeemPoints,
      setRedeemPoints,
      stampRedemptions,
      toggleStampRedemption,
    }),
    [
      lines,
      itemCount,
      subtotal,
      addProduct,
      setQty,
      removeLine,
      clear,
      toSaleLines,
      customer,
      setCustomer,
      redeemPoints,
      setRedeemPoints,
      stampRedemptions,
      toggleStampRedemption,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
