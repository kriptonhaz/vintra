import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getPOSCashierMasters,
  getPOSBranchHours,
  createSale,
  getCustomerLoyaltySummary,
  listPOSProducts,
} from '@/server/functions/pos'
import { getCurrentOpenSession } from '@/server/functions/pos-cash'
import { getCustomerStampCards } from '@/server/functions/loyalty-stamps'
import { getCustomerKasbon } from '@/server/functions/cashflow-ar'
import {
  listActivePromotions,
  validatePromoCode,
} from '@/server/functions/promotions'
import { Clock, AlertTriangle, ShoppingCart, Stamp, X } from 'lucide-react'
import {
  CashierProductGrid,
  type POSProduct,
  type POSVariant,
} from '@/components/pos/cashier-product-grid'
import {
  CashierCart,
  computeCartTotals,
  type CartLine,
} from '@/components/pos/cashier-cart'
import { UnitTierModal } from '@/components/pos/unit-tier-modal'
import { PaymentModal } from '@/components/pos/payment-modal'
import { AdhocLineModal } from '@/components/pos/adhoc-line-modal'
import { SaleSuccessModal } from '@/components/pos/sale-success-modal'
import { PrepBatchSheet } from '@/components/pos/prep-batch-sheet'
import { BukaKasModal } from '@/components/pos/cash/buka-kas-modal'
import { KasHeaderChip } from '@/components/pos/cash/kas-header-chip'
import { SetorTarikModal } from '@/components/pos/cash/setor-tarik-modal'
import { TutupKasModal } from '@/components/pos/cash/tutup-kas-modal'
import { StaleSessionModal } from '@/components/pos/cash/stale-session-modal'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { safeLocalStorage, safeSessionStorage } from '@/lib/safe-storage'
import { useCurrentUser } from '@/hooks/use-permissions'
import { useBranch } from '@/hooks/use-branch'
import {
  POS_PRICE_CHANGED_ERROR_PREFIX,
  type POSPaymentMethod,
} from '@vintra/shared'

export const Route = createFileRoute('/_authed/pos/cashier')({
  component: CashierPage,
})

function CashierPage() {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()
  const tenantName = currentUser?.tenant?.businessName ?? 'Toko'
  const { selectedBranchId } = useBranch()

  const [branchId, setBranchId] = React.useState<string>('')
  const [lines, setLines] = React.useState<CartLine[]>([])
  const [customerName, setCustomerName] = React.useState('')
  const [customerPhone, setCustomerPhone] = React.useState('')
  /** Resolved customer row id (set by the picker when an existing
   *  customer is chosen, or after a freshly-created one is attached).
   *  Required to drive the loyalty balance fetch + redeem flow. */
  const [customerId, setCustomerId] = React.useState<string | null>(null)
  /** Points the cashier wants to redeem on this transaction. Server
   *  validates against the customer's actual balance + post-discount
   *  subtotal cap, so the client value is just a UX hint. */
  const [redeemPoints, setRedeemPoints] = React.useState(0)
  /** JUR-195: active stamp redemptions on this sale. Each entry pins
   *  the program being redeemed to the cart row turned into the free
   *  reward line, so cancelling is precise. */
  // Each redemption pins 1+ cart rows: single rewards pin one row,
  // bundle rewards pin one per bundle item. Storing as rowKeys[] lets
  // bundle cancel-redeem clear every line it discounted.
  // `rowKeys` is the full pin set (every line discounted to 100% by this
  // redemption); `autoAddedRowKeys` is the subset that this redemption
  // itself put into the cart, so cancel can yank them back out instead
  // of leaving stranded free items behind. Pre-existing lines the
  // cashier had already rang up only get their lineDiscount cleared.
  const [stampRedeems, setStampRedeems] = React.useState<
    Array<{
      programId: string
      rowKeys: string[]
      autoAddedRowKeys: string[]
    }>
  >([])
  const [discountType, setDiscountType] = React.useState<
    'fixed' | 'percent' | null
  >(null)
  const [discountValue, setDiscountValue] = React.useState(0)
  /** Cashier-typed promo code (JUR-9). Server validates on createSale. */
  const [promoCode, setPromoCode] = React.useState('')
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [adhocOpen, setAdhocOpen] = React.useState(false)
  const [unitModalProduct, setUnitModalProduct] = React.useState<POSProduct | null>(null)
  const [variantModalProduct, setVariantModalProduct] =
    React.useState<POSProduct | null>(null)
  // JUR-15: prep-batch sheet state. Only opens for prep-mode tiles
  // when the user has inventory.write — gating happens here at the
  // page level so the grid doesn't have to know about permissions.
  const [prepBatchProduct, setPrepBatchProduct] = React.useState<POSProduct | null>(null)
  const [activeTab, setActiveTab] = React.useState<'products' | 'cart'>('products')
  const [successSale, setSuccessSale] = React.useState<{
    id: string
    number: string
    total: number
    customerPhone: string | null
    loyalty?: {
      pointsEarned: number
      pointsRedeemed: number
      newBalance: number
      priorBalance: number
      redeemAmount: number
    } | null
  } | null>(null)

  const masters = useQuery({
    queryKey: ['pos', 'cashier-masters', branchId],
    queryFn: () => getPOSCashierMasters({ data: { branchId: branchId || undefined } }),
    staleTime: 60 * 1000,
  })

  const hours = useQuery({
    queryKey: ['pos', 'branch-hours', branchId],
    queryFn: () => getPOSBranchHours({ data: { branchId } }),
    enabled: Boolean(branchId),
    refetchInterval: 60 * 1000,
  })

  // Fetch the attached customer's loyalty balance whenever both the
  // customer + loyalty config are known. The query auto-disables when
  // the cashier detaches the customer or loyalty is off, and refetches
  // after each successful sale (createSale invalidates ['pos']) so the
  // balance shown in the picker stays accurate across multiple sales
  // in the same shift.
  const loyaltyConfig = masters.data?.loyalty
  const loyaltySummary = useQuery({
    queryKey: ['pos', 'loyalty-summary', customerId],
    queryFn: () =>
      getCustomerLoyaltySummary({ data: { customerId: customerId! } }),
    enabled: Boolean(customerId && loyaltyConfig?.active),
    staleTime: 30 * 1000,
  })

  // JUR-191: the attached customer's outstanding kasbon. Drives the
  // payment modal's kasbon affordances. Returns 0 for non-Komplit
  // tenants, so the modal simply shows nothing kasbon-related there.
  const kasbonSummary = useQuery({
    queryKey: ['pos', 'kasbon-summary', customerId],
    queryFn: () => getCustomerKasbon({ data: { customerId: customerId! } }),
    enabled: Boolean(customerId),
    staleTime: 30 * 1000,
  })

  // JUR-195: the attached customer's stamp cards. Same Komplit gate
  // as the points balance — `loyaltyConfig.active` covers it.
  const stampCards = useQuery({
    queryKey: ['pos', 'stamp-cards', customerId],
    queryFn: () =>
      getCustomerStampCards({ data: { customerId: customerId! } }),
    enabled: Boolean(customerId && loyaltyConfig?.stampActive),
    staleTime: 30 * 1000,
  })
  // Project stamps that the in-progress cart would earn, then override
  // canRedeem so a customer whose 5th-stamp purchase is in the cart
  // right now sees the "Tukar gratis" button immediately (matches the
  // server's earn-before-redeem ordering in createSale).
  const augmentedStampCards = React.useMemo<
    AugmentedStampCard[] | undefined
  >(() => {
    if (!stampCards.data) return undefined
    const projected = projectStampEarn(lines, stampCards.data)
    return stampCards.data.map((c) => {
      const earn = projected.get(c.programId) ?? 0
      const projectedStamps = c.currentStamps + earn
      return {
        ...c,
        projectedEarn: earn,
        projectedStamps,
        canRedeem: projectedStamps >= c.stampsRequired,
      }
    })
  }, [stampCards.data, lines])
  const customerKasbon = kasbonSummary.data?.kasbon ?? 0

  // Live promo-code preview (JUR-9). Without this, the cart breakdown
  // and the payment modal would show the pre-promo total even though
  // the server applies the discount on createSale — leading to the
  // cashier collecting more cash than the customer should pay.
  // Debounced via React state; query key includes the cart subtotal so
  // changing qty re-validates against the new min-cart threshold.
  const trimmedPromoCode = promoCode.trim().toUpperCase()
  const supportsPromoCodes = (
    masters.data?.features ?? []
  ).includes('promo_codes')
  // Whether the cashier offers the promo-code box. Server-resolved (tier
  // AND the tenant's setting). Distinct from `supportsPromoCodes`, which
  // still drives the AUTO-promo query below: a tenant can hide the typed
  // code box and keep their automatic product/category promos running.
  const showPromoCodeField = masters.data?.showPromoCodeField ?? false

  // Tenant's active auto-promos (product / category / cart). The
  // cashier-cart bakes their per-line discount into the breakdown +
  // Bayar button so the cashier collects what createSale will charge.
  // Without this, auto-promos materialised only at checkout — leaving
  // the cashier collecting the pre-discount amount.
  const activeAutoPromosQuery = useQuery({
    queryKey: ['pos', 'active-promos'],
    queryFn: () => listActivePromotions(),
    enabled: supportsPromoCodes,
    staleTime: 60 * 1000,
  })
  const activeAutoPromos = activeAutoPromosQuery.data ?? []

  // Pre-compute the post-line, post-sale-discount subtotal that
  // server-side createSale uses as the promo base. Mirrors the math in
  // computeCartTotals so the validation amount agrees with what the
  // server will persist.
  const previewBase = computeCartTotals({
    lines,
    discountType,
    discountValue,
    taxes: masters.data?.taxes ?? [],
    activeAutoPromos,
  })
  const promoCartBase = Math.max(
    0,
    previewBase.subtotal - previewBase.discountAmount,
  )
  const [debouncedPromoKey, setDebouncedPromoKey] = React.useState({
    code: '',
    base: 0,
  })
  React.useEffect(() => {
    // 300ms debounce — typing pause threshold that doesn't fire mid-
    // keystroke but still feels live to the cashier.
    const t = setTimeout(() => {
      setDebouncedPromoKey({
        code: trimmedPromoCode,
        base: promoCartBase,
      })
    }, 300)
    return () => clearTimeout(t)
  }, [trimmedPromoCode, promoCartBase])
  const promoQuery = useQuery({
    queryKey: [
      'pos',
      'validate-promo',
      debouncedPromoKey.code,
      debouncedPromoKey.base,
      customerId,
    ],
    queryFn: () =>
      validatePromoCode({
        data: {
          code: debouncedPromoKey.code,
          cartSubtotal: debouncedPromoKey.base,
          customerId: customerId ?? null,
        },
      }),
    enabled:
      supportsPromoCodes &&
      debouncedPromoKey.code.length > 0 &&
      debouncedPromoKey.base > 0,
    staleTime: 30 * 1000,
  })
  const promoAmount =
    promoQuery.data?.valid === true ? promoQuery.data.amount : 0
  const promoLabel =
    promoQuery.data?.valid === true ? promoQuery.data.promo.name : null
  const promoError =
    promoQuery.data?.valid === false ? promoQuery.data.error : null

  // Follow the global topbar branch selection. The cashier used to
  // keep a sticky local copy (so a topbar change elsewhere wouldn't
  // clobber an in-progress sale), but the in-page selector that made
  // that escape hatch usable is gone — the global selector is the only
  // control, so the cashier honors it. Falls back to the first POS
  // branch when the global selection isn't a POS-enabled branch.
  React.useEffect(() => {
    const posBranches = masters.data?.branches
    if (!posBranches || posBranches.length === 0) return
    const next =
      posBranches.find((b) => b.id === selectedBranchId) ?? posBranches[0]!
    if (branchId !== next.id) setBranchId(next.id)
  }, [branchId, masters.data, selectedBranchId])

  // ── JUR-141 Peti Kas (cash drawer) ──────────────────────────
  // Polls every 30s so a manual close/open in another tab doesn't
  // leave the cashier UI showing stale balance.
  const cashDrawerEnabled = masters.data?.cashDrawer?.enabled ?? false
  const varianceThreshold = masters.data?.cashDrawer?.varianceThreshold ?? 10000
  const cashSessionQuery = useQuery({
    queryKey: ['pos', 'cash-current-session', branchId],
    queryFn: () => getCurrentOpenSession({ data: { branchId } }),
    enabled: Boolean(branchId) && cashDrawerEnabled,
    refetchInterval: 30 * 1000,
    staleTime: 10 * 1000,
  })
  const [setorTarikModal, setSetorTarikModal] = React.useState<
    null | 'drop' | 'payout'
  >(null)
  const [tutupKasOpen, setTutupKasOpen] = React.useState(false)

  // JUR-145 PR 4 — onboarding banner. Dismissed via localStorage so
  // it stays gone forever once the cashier clicks Tutup. Hooks live
  // here (with the rest of the state) because cashier.tsx has early
  // returns lower down — Rules of Hooks demands every hook fires on
  // every render.
  const [bannerDismissed, setBannerDismissed] = React.useState(true)
  React.useEffect(() => {
    setBannerDismissed(
      safeLocalStorage.getItem('jq_peti_kas_banner_dismissed') === '1',
    )
  }, [])

  async function refreshCashSession() {
    await queryClient.invalidateQueries({
      queryKey: ['pos', 'cash-current-session', branchId],
    })
    // The session-detail cache also needs busting so TutupKasModal
    // sees the latest movements.
    await queryClient.invalidateQueries({
      queryKey: ['pos', 'cash-session-detail'],
    })
  }

  // After closing the till, leave the cashier instead of refreshing in
  // place. With no open session the cashier would immediately re-prompt
  // BukaKas, which feels like the close "didn't take" — annoying right
  // after a deliberate close. Navigate to the POS dashboard first (so
  // the cashier unmounts before it can flash BukaKas), then refresh POS
  // caches so the dashboard reflects the now-closed session.
  async function handleKasClosed() {
    await router.navigate({ to: '/pos' })
    await queryClient.invalidateQueries({ queryKey: ['pos'] })
  }

  /**
   * Re-price every cart line from the current price list.
   *
   * Runs when the server refuses a sale because a price moved under the open
   * cart. Rewriting the lines in place — rather than clearing the cart or
   * reloading the page — is what lets the cashier see exactly which figure
   * changed while everything already rung up survives.
   */
  async function refreshCartPrices() {
    const itemIds = Array.from(
      new Set(lines.filter((l) => !l.isAdhoc && l.itemId).map((l) => l.itemId!)),
    )
    if (itemIds.length === 0 || !branchId) return

    // `itemIds` is capped at 50 server-side. Chunk rather than truncate:
    // dropping the tail would leave exactly the stale prices this is meant to
    // fix, and the cashier would loop on the same refusal.
    const byId = new Map<string, POSProduct>()
    try {
      for (let i = 0; i < itemIds.length; i += 50) {
        const res = await listPOSProducts({
          data: { branchId, itemIds: itemIds.slice(i, i + 50) },
        })
        for (const p of (res.items ?? []) as POSProduct[]) byId.set(p.id, p)
      }
    } catch {
      // Leave the cart alone. Prices stay as they were, the server keeps
      // refusing, and the cashier can retry — better than half-updating.
      return
    }

    setLines((prev) =>
      prev.map((l) => {
        if (l.isAdhoc || !l.itemId) return l
        const unit = byId.get(l.itemId)?.units.find((u) => u.unitId === l.unitId)
        if (!unit) return l
        const matched = retier(unit.tiers, l.qty)
        if (!matched) return l
        return {
          ...l,
          tiers: unit.tiers,
          unitPrice: matched.unitPrice,
          isBulk: matched.minQty > 1,
        }
      }),
    )

    // The grid tiles show prices too — leaving them stale would have the cart
    // and the tile disagree about the same item.
    void queryClient.invalidateQueries({ queryKey: ['pos', 'products'] })
  }

  const create = useMutation({
    mutationFn: (input: {
      method: POSPaymentMethod
      paidAmount: number
      isKasbon: boolean
      kasbonPayment: number
    }) => {
      return createSale({
        data: {
          branchId,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            variantId: l.variantId ?? undefined,
            unitId: l.unitId,
            name: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
            // Which tier this line was quoted from. Opts the line into the
            // server's price-changed guard: it refuses only when the server
            // lands on this same tier at a different price, i.e. the price
            // list was edited while the cart was open. This cart re-tiers on
            // every qty change, so the tier it names is always the one its
            // displayed price came from.
            quotedTierMinQty: retier(l.tiers ?? [], l.qty)?.minQty,
            isAdhoc: l.isAdhoc,
            // JUR-7: per-line discount. Null when not set; server
            // ignores zero-value entries either way.
            lineDiscount: l.lineDiscount ?? undefined,
          })),
          paymentMethod: input.method,
          paidAmount: input.paidAmount,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
          // JUR-195: only send redemptions whose pinned reward line is
          // still in the cart and still free.
          stampRedemptions: (() => {
            // Send only redemptions whose ALL pinned reward lines are
            // still present and still 100%-off. Cashier may have
            // removed or restored some lines after pinning.
            const ids = stampRedeems
              .filter((r) =>
                r.rowKeys.every((rk) => {
                  const line = lines.find((l) => l.rowKey === rk)
                  return line != null && line.lineDiscount?.value === 100
                }),
              )
              .map((r) => r.programId)
            return ids.length > 0 ? ids : undefined
          })(),
          promoCode: promoCode.trim() ? promoCode.trim() : undefined,
          discount:
            discountType && discountValue > 0
              ? { type: discountType, value: discountValue }
              : undefined,
          // JUR-191 kasbon.
          isKasbon: input.isKasbon || undefined,
          kasbonPayment:
            input.kasbonPayment > 0 ? input.kasbonPayment : undefined,
        },
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pos'] })
      setPaymentOpen(false)
      // Use the same totals the cart + payment modal showed so the
      // success modal matches what the cashier just collected.
      const { total } = computeCartTotals({
        lines,
        discountType,
        discountValue,
        promoAmount,
        redeemPoints,
        redeemRate: loyaltyConfig?.redeemRate ?? 0,
        taxes: masters.data?.taxes ?? [],
        activeAutoPromos,
      })
      setSuccessSale({
        id: data.saleId,
        number: data.saleNumber,
        total,
        customerPhone: customerPhone || null,
        loyalty: data.loyalty ?? null,
      })

      // JUR-191: confirm the kasbon effect so the cashier can tell the
      // customer their new balance.
      if (data.kasbonCreated > 0 || data.kasbonPaid > 0) {
        const parts: string[] = []
        if (data.kasbonPaid > 0)
          parts.push(`Bayar kasbon ${formatRupiah(data.kasbonPaid)}`)
        if (data.kasbonCreated > 0)
          parts.push(`Kasbon baru ${formatRupiah(data.kasbonCreated)}`)
        toast({
          title: 'Kasbon diperbarui',
          description: parts.join(' · '),
          variant: 'success',
        })
      }

      // Free-tier soft nudge (JUR-10): server flags `recipeNudge=true`
      // when a recipe-backed product was sold but the tier doesn't
      // include `ingredient_consumption`. Show a one-time-per-session
      // toast inviting upgrade — sessionStorage flag prevents repeat
      // nags after the first dismissal in this browser session.
      if (data.recipeNudge && !safeSessionStorage.getItem('jq_recipe_nudge_seen')) {
        safeSessionStorage.setItem('jq_recipe_nudge_seen', '1')
        toast({
          title: 'Auto-deduct bahan tersedia di paket Toko',
          description:
            'Resep terdeteksi. Upgrade untuk otomatis mengurangi stok bahan setiap penjualan.',
        })
      }
    },
    onError: (err: Error) => {
      // The price list moved while this cart was open. The server refused
      // rather than ringing up a figure the cashier never quoted; pull the
      // new prices into the cart so the next Bayar press is a deliberate
      // confirmation of what is now on screen.
      if (err.message.startsWith(POS_PRICE_CHANGED_ERROR_PREFIX)) {
        toast({
          title: 'Harga berubah',
          description: err.message,
          variant: 'error',
        })
        void refreshCartPrices()
        return
      }

      // JUR-141: server rejects cash sales when cash drawer is on +
      // no session is open. Match the literal Indonesian error
      // string from pos-cash.ts and bounce the cashier into the
      // BukaKasModal by refetching the session state (which will
      // confirm null and render the modal).
      if (err.message === 'Buka Kas dulu sebelum jualan tunai.') {
        toast({
          title: 'Buka Kas dulu',
          description: 'Tutup pop-up pembayaran, lalu buka kas sebelum mencatat transaksi tunai.',
          variant: 'error',
        })
        void refreshCashSession()
        return
      }
      toast({
        title: 'Transaksi gagal',
        description: err.message,
        variant: 'error',
      })
    },
  })

  /**
   * Tap a product card. If it has just 1 unit AND 1 tier (the simplest
   * case — typical "1 pcs at fixed price"), snap straight to the
   * cart with qty=1. Otherwise pop the unit-tier modal so the cashier
   * can pick unit + qty + see bulk thresholds.
   */
  function handleProductTap(p: POSProduct) {
    // Variant items → pick the combo first (each has its own price + stock).
    if (p.hasVariants && p.variants && p.variants.length > 0) {
      setVariantModalProduct(p)
      return
    }
    const isSimple =
      p.units.length === 1 && (p.units[0]?.tiers.length ?? 0) <= 1
    if (isSimple) {
      const unit = p.units[0]!
      const tier = unit.tiers[0]!
      addOrMergeLine({
        product: p,
        unitId: unit.unitId,
        unitLabel: unit.unitLabel,
        ratioToBase: unit.ratioToBase,
        qty: 1,
        unitPrice: tier.unitPrice,
        isBulk: false,
        tiers: unit.tiers,
      })
      return
    }
    setUnitModalProduct(p)
  }

  /**
   * Add or merge a line. Lines are deduped by (itemId, unitId) so
   * re-tapping the same product+unit increments qty + re-tiers price.
   * If the cashier wants a different unit of the same item, that's a
   * separate line.
   */
  function addOrMergeLine(input: {
    product: POSProduct
    unitId: string
    unitLabel: string
    ratioToBase: number
    qty: number
    unitPrice: number
    isBulk: boolean
    tiers: Array<{ minQty: number; unitPrice: number }>
    /** Variant fields — set when adding a specific variant combo. */
    variantId?: string | null
    variantLabel?: string | null
    /** Stock cap for this line; overrides product.stockInBase (variants). */
    stockOverride?: number
  }) {
    const variantId = input.variantId ?? null
    const stockCap = input.stockOverride ?? input.product.stockInBase
    setLines((prev) => {
      const existing = prev.find(
        (l) =>
          l.itemId === input.product.id &&
          l.unitId === input.unitId &&
          (l.variantId ?? null) === variantId,
      )
      if (existing) {
        const newQty = existing.qty + input.qty
        const matched = retier(input.tiers, newQty)
        return prev.map((l) =>
          l.rowKey === existing.rowKey
            ? {
                ...l,
                qty: newQty,
                unitPrice: matched?.unitPrice ?? l.unitPrice,
                isBulk: matched ? matched.minQty > 1 : l.isBulk,
                // Refresh stock snapshot — the product list may have
                // refetched between the two adds.
                stockInBase: stockCap,
                recipeBacked: input.product.recipeBacked ?? false,
                trackStock: input.product.trackStock ?? true,
              }
            : l,
        )
      }
      return [
        ...prev,
        {
          rowKey: crypto.randomUUID(),
          itemId: input.product.id,
          variantId,
          variantLabel: input.variantLabel ?? null,
          categoryId: input.product.categoryId ?? null,
          unitId: input.unitId,
          name: input.product.name,
          unitLabel: input.unitLabel,
          ratioToBase: input.ratioToBase,
          qty: input.qty,
          unitPrice: input.unitPrice,
          isBulk: input.isBulk,
          isAdhoc: false,
          tiers: input.tiers,
          stockInBase: stockCap,
          recipeBacked: input.product.recipeBacked ?? false,
          trackStock: input.product.trackStock ?? true,
        },
      ]
    })
  }

  function addAdhoc(input: { name: string; unitPrice: number; qty: number }) {
    setLines((prev) => [
      ...prev,
      {
        rowKey: crypto.randomUUID(),
        itemId: null,
        unitId: null,
        name: input.name,
        unitLabel: undefined,
        ratioToBase: undefined,
        qty: input.qty,
        unitPrice: input.unitPrice,
        isBulk: false,
        isAdhoc: true,
      },
    ])
  }

  /**
   * Update line. When qty changes on a tiered (non-adhoc) line, we
   * automatically re-match the tier so the customer always sees the
   * cheapest applicable price as they adjust qty.
   */
  function updateLine(rowKey: string, patch: Partial<CartLine>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.rowKey !== rowKey) return l
        const merged = { ...l, ...patch }
        if (patch.qty != null && l.tiers && l.tiers.length > 0) {
          const matched = retier(l.tiers, merged.qty)
          if (matched) {
            merged.unitPrice = matched.unitPrice
            merged.isBulk = matched.minQty > 1
          }
        }
        return merged
      }),
    )
  }

  function removeLine(rowKey: string) {
    setLines((prev) => prev.filter((l) => l.rowKey !== rowKey))
    // Drop any stamp redemption that included the removed row in its
    // pin set. Bundle redemptions are all-or-nothing — losing one
    // bundle item invalidates the whole redemption.
    setStampRedeems((prev) => prev.filter((r) => !r.rowKeys.includes(rowKey)))
  }

  function resetCart() {
    setLines([])
    setCustomerName('')
    setCustomerPhone('')
    setCustomerId(null)
    setRedeemPoints(0)
    setStampRedeems([])
    setDiscountType(null)
    setDiscountValue(0)
    setPromoCode('')
  }

  /**
   * JUR-195: redeem a full stamp card.
   *
   * - Single reward (rewardMode='single'): pins ONE reward line and
   *   100%-discounts it. If the cashier has already rang up the reward
   *   item, that existing line is used; otherwise the line is auto-
   *   added (qty=1, default unit, lowest applicable tier).
   * - Bundle reward (rewardMode='bundle'): pins ONE line PER bundle
   *   item, 100%-discounts each. Missing items are auto-added with
   *   qty = reward.quantity. Auto-added rows are tracked so a cancel
   *   pulls them back out instead of leaving free items in the cart.
   */
  async function redeemStamp(card: StampCard) {
    const pinnedRows = new Set(stampRedeems.flatMap((r) => r.rowKeys))

    type RewardNeed = { itemId: string; itemName: string; quantity: number }
    const needs: RewardNeed[] =
      card.rewardMode === 'bundle'
        ? (card.bundleRewards ?? []).map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            quantity: r.quantity,
          }))
        : card.rewardItemId
          ? [
              {
                itemId: card.rewardItemId,
                itemName: card.rewardItemName ?? 'Hadiah',
                quantity: 1,
              },
            ]
          : []

    if (card.rewardMode === 'bundle' && needs.length === 0) {
      toast({
        title: 'Bundle belum dikonfigurasi',
        description: 'Hubungi pemilik untuk mengisi item bundle hadiah.',
        variant: 'error',
      })
      return
    }
    if (card.rewardMode === 'single' && needs.length === 0) {
      toast({
        title: 'Hadiah belum dikonfigurasi',
        description: 'Hubungi pemilik untuk mengisi item hadiah program ini.',
        variant: 'error',
      })
      return
    }

    // Pass 1: claim existing unpinned cart lines first, so a cashier
    // who already rang up the reward doesn't end up with a duplicate
    // row. Anything not satisfied becomes a fetch-and-auto-add need.
    const claim = new Set<string>(pinnedRows)
    const pickedExisting: string[] = []
    const missing: RewardNeed[] = []
    for (const need of needs) {
      const line = lines.find(
        (l) =>
          !l.isAdhoc &&
          l.itemId === need.itemId &&
          !claim.has(l.rowKey),
      )
      if (line) {
        claim.add(line.rowKey)
        pickedExisting.push(line.rowKey)
      } else {
        missing.push(need)
      }
    }

    // Pass 2: fetch missing reward items as POSProducts (the catalog
    // grid query is filtered by search/category, so we target by id
    // to find items outside the current view) and build cart lines.
    const newLines: CartLine[] = []
    if (missing.length > 0) {
      if (!branchId) {
        toast({
          title: 'Pilih cabang dulu',
          description: 'Cabang belum dipilih — tidak bisa menambahkan hadiah.',
          variant: 'error',
        })
        return
      }
      let products: POSProduct[]
      try {
        const res = await listPOSProducts({
          data: {
            branchId,
            itemIds: missing.map((n) => n.itemId),
          },
        })
        products = (res.items ?? []) as POSProduct[]
      } catch (err) {
        toast({
          title: 'Gagal memuat item hadiah',
          description: err instanceof Error ? err.message : 'Coba lagi.',
          variant: 'error',
        })
        return
      }
      const productById = new Map(products.map((p) => [p.id, p]))

      for (const need of missing) {
        const p = productById.get(need.itemId)
        if (!p) {
          toast({
            title: 'Item hadiah tidak tersedia',
            description: `"${need.itemName}" tidak ditemukan di katalog cabang ini.`,
            variant: 'error',
          })
          return
        }
        const unit = p.units.find((u) => u.isDefault) ?? p.units[0]
        if (!unit || unit.tiers.length === 0) {
          toast({
            title: 'Item hadiah belum punya harga',
            description: `"${need.itemName}" belum dikonfigurasi satuan/harga.`,
            variant: 'error',
          })
          return
        }
        const tier = retier(unit.tiers, need.quantity) ?? unit.tiers[0]!
        newLines.push({
          rowKey: crypto.randomUUID(),
          itemId: p.id,
          categoryId: p.categoryId ?? null,
          unitId: unit.unitId,
          name: p.name,
          unitLabel: unit.unitLabel,
          ratioToBase: unit.ratioToBase,
          qty: need.quantity,
          unitPrice: tier.unitPrice,
          isBulk: tier.minQty > 1,
          isAdhoc: false,
          tiers: unit.tiers,
          stockInBase: p.stockInBase,
          recipeBacked: p.recipeBacked ?? false,
          trackStock: p.trackStock ?? true,
        })
      }
    }

    const autoAddedRowKeys = newLines.map((l) => l.rowKey)
    const pickedAll = [...pickedExisting, ...autoAddedRowKeys]
    const pickedSet = new Set(pickedAll)

    // Single setLines pass — append the auto-added rows then apply the
    // 100% line discount across the whole pin set in one go.
    setLines((prev) => {
      const combined = [...prev, ...newLines]
      return combined.map((l) =>
        pickedSet.has(l.rowKey)
          ? { ...l, lineDiscount: { type: 'percent', value: 100 } }
          : l,
      )
    })
    setStampRedeems((prev) => [
      ...prev,
      {
        programId: card.programId,
        rowKeys: pickedAll,
        autoAddedRowKeys,
      },
    ])
  }

  function cancelStampRedeem(programId: string) {
    const entry = stampRedeems.find((r) => r.programId === programId)
    if (!entry) return
    const autoSet = new Set(entry.autoAddedRowKeys)
    const keepSet = new Set(
      entry.rowKeys.filter((k) => !autoSet.has(k)),
    )
    setLines((prev) =>
      prev
        // Auto-added rows came in WITH the redemption — yank them so
        // the cart goes back to what the cashier had rang up.
        .filter((l) => !autoSet.has(l.rowKey))
        // Pre-existing rows stay; just clear the 100% line discount.
        .map((l) =>
          keepSet.has(l.rowKey) ? { ...l, lineDiscount: null } : l,
        ),
    )
    setStampRedeems((prev) => prev.filter((r) => r !== entry))
  }

  if (masters.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Memuat…</div>
  }

  const m = masters.data
  if (!m) return null

  if (m.branches.length === 0) {
    // JUR-135: distinguish "tenant has zero branches" (owner-onboarding
    // state) from "member's pin set has zero overlap with tenant
    // branches" (restricted-but-no-access — owner needs to assign).
    return (
      <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900">
        {m.branchAccessRestricted
          ? 'Anda belum punya akses ke cabang manapun. Hubungi pemilik untuk memberi akses cabang.'
          : 'Belum ada cabang. Tambahkan cabang dari menu Data Master > Cabang lebih dulu.'}
      </div>
    )
  }

  const cartItemIds = new Set(lines.map((l) => l.itemId).filter(Boolean) as string[])
  const { total } = computeCartTotals({
    lines,
    discountType,
    discountValue,
    promoAmount,
    redeemPoints,
    redeemRate: loyaltyConfig?.redeemRate ?? 0,
    taxes: m.taxes,
    activeAutoPromos,
  })

  const h = hours.data
  const showHoursWarn = h && h.configured && (!h.isWorkDay || !h.isOpenNow)

  // JUR-141 Peti Kas state derived from the cash-session query.
  const kasSession = cashSessionQuery.data?.session ?? null
  const kasDisabled =
    cashSessionQuery.data?.disabled === true || !cashDrawerEnabled
  const showBukaKas = cashDrawerEnabled && !kasDisabled && !kasSession
  const showStaleKas =
    cashDrawerEnabled && !kasDisabled && !!kasSession && kasSession.isStale

  // JUR-145 PR 4 — onboarding banner shown only when the feature is
  // enabled (so free / opted-out tenants never see it). The hooks
  // backing this live above the early returns; this is just the
  // derived flag + dismiss handler.
  function dismissBanner() {
    safeLocalStorage.setItem('jq_peti_kas_banner_dismissed', '1')
    setBannerDismissed(true)
  }
  const showBanner = cashDrawerEnabled && !bannerDismissed

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Mobile-only header — Peti Kas pill (when active) + Produk /
          Keranjang segmented control. On desktop the Peti Kas pill
          lives on the same row as the product search to free up
          vertical space; the segmented control is desktop-irrelevant
          since both panes are visible. */}
      <div className="flex flex-col gap-2 border-b border-gray-200 pb-3 lg:hidden dark:border-gray-700">
        {kasSession && cashDrawerEnabled && (
          <KasHeaderChip
            runningBalance={kasSession.runningBalance}
            onSetor={() => setSetorTarikModal('drop')}
            onTarik={() => setSetorTarikModal('payout')}
            onTutup={() => setTutupKasOpen(true)}
          />
        )}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          <SegmentButton
            active={activeTab === 'products'}
            onClick={() => setActiveTab('products')}
          >
            Produk
          </SegmentButton>
          <SegmentButton
            active={activeTab === 'cart'}
            onClick={() => setActiveTab('cart')}
          >
            Keranjang{lines.length > 0 ? ` (${lines.length})` : ''}
          </SegmentButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden pt-3">
        <div
          className={
            activeTab === 'products'
              ? 'flex min-h-0 min-w-0 flex-1 flex-col lg:basis-[60%]'
              : 'hidden min-h-0 min-w-0 lg:flex lg:flex-1 lg:basis-[60%] lg:flex-col'
          }
        >
          <div className="flex h-full w-full min-h-0 flex-col gap-3">
            {/* Banners live inside the products column so they align to
                the product-list width and leave the cart pane its full
                height (JUR-201 follow-up). */}
            {showHoursWarn && (
              <div className="flex shrink-0 items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-200">
                {!h.isWorkDay ? (
                  <>
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Cabang ini tutup hari ini menurut jadwal. Anda tetap bisa
                      mencatat transaksi, tapi pastikan ini disengaja.
                    </span>
                  </>
                ) : (
                  <>
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Di luar jam buka cabang ({h.clockInTime?.slice(0, 5)} –{' '}
                      {h.clockOutTime?.slice(0, 5)}). Transaksi tetap bisa
                      dicatat — tutup atau buka cepat masih dianggap sah.
                    </span>
                  </>
                )}
              </div>
            )}
            {showBanner && (
              <div className="flex shrink-0 items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-700/40 dark:bg-brand-900/20">
                <span className="text-base">🆕</span>
                <div className="flex-1">
                  <p className="font-medium text-brand-900 dark:text-brand-100">
                    Fitur Baru: Peti Kas
                  </p>
                  <p className="mt-0.5 text-xs text-brand-800 dark:text-brand-300">
                    Mulai sekarang, kamu perlu buka kas sebelum jualan tunai.
                    Bantu cegah selisih uang & lihat rekonsiliasi harian di
                    menu Peti Kas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissBanner}
                  className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Tutup
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <CashierProductGrid
                branchId={branchId}
                cartItemIds={cartItemIds}
                onAdd={handleProductTap}
                onPrepBatch={
                  currentUser?.permissions.includes('inventory.write')
                    ? (p) => setPrepBatchProduct(p)
                    : undefined
                }
                headerRight={
                  // Desktop only — mobile keeps the chip in its own
                  // header row above (the search row is tight at
                  // narrow widths and the segmented control needs the
                  // full width).
                  kasSession && cashDrawerEnabled ? (
                    <div className="hidden lg:block">
                      <KasHeaderChip
                        runningBalance={kasSession.runningBalance}
                        onSetor={() => setSetorTarikModal('drop')}
                        onTarik={() => setSetorTarikModal('payout')}
                        onTutup={() => setTutupKasOpen(true)}
                      />
                    </div>
                  ) : undefined
                }
              />
            </div>
          </div>
        </div>
        <div
          className={
            activeTab === 'cart'
              ? 'flex min-h-0 min-w-0 flex-1 flex-col lg:basis-[40%]'
              : 'hidden min-h-0 min-w-0 lg:flex lg:basis-[40%] lg:flex-col'
          }
        >
          <div className="flex h-full w-full min-h-0 flex-col rounded-xl border-2 border-brand-200 bg-white p-4 dark:border-brand-800/50 dark:bg-gray-800">
            {loyaltyConfig?.stampActive &&
              customerId &&
              augmentedStampCards &&
              augmentedStampCards.length > 0 && (
                <StampRedeemPanel
                  cards={augmentedStampCards}
                  redeemedProgramIds={stampRedeems.map((r) => r.programId)}
                  onRedeem={redeemStamp}
                  onCancel={cancelStampRedeem}
                />
              )}
            <CashierCart
              lines={lines}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
              onAddAdhoc={() => setAdhocOpen(true)}
              allowAdhocItems={m.allowAdhocItems ?? false}
              onCheckout={() => setPaymentOpen(true)}
              activeAutoPromos={activeAutoPromos}
              features={m.features}
              taxes={m.taxes}
              customerId={customerId}
              customerName={customerName}
              customerPhone={customerPhone}
              onCustomerAttach={(c) => {
                setCustomerName(c.name)
                setCustomerPhone(c.phone)
                setCustomerId(c.id ?? null)
                // Reset any prior redeem from a previous customer.
                setRedeemPoints(0)
                setStampRedeems([])
              }}
              onCustomerDetach={() => {
                setCustomerName('')
                setCustomerPhone('')
                setCustomerId(null)
                setRedeemPoints(0)
                setStampRedeems([])
              }}
              loyalty={
                loyaltyConfig?.active && customerId
                  ? {
                      earnRate: loyaltyConfig.earnRate,
                      redeemRate: loyaltyConfig.redeemRate,
                      pointsBalance:
                        loyaltySummary.data?.pointsBalance ?? null,
                      redeemPoints,
                      onRedeemPointsChange: setRedeemPoints,
                    }
                  : null
              }
              discountType={discountType}
              discountValue={discountValue}
              onDiscountTypeChange={setDiscountType}
              onDiscountValueChange={setDiscountValue}
              promoCode={promoCode}
              onPromoCodeChange={setPromoCode}
              showPromoCodeField={showPromoCodeField}
              promoAmount={promoAmount}
              promoLabel={promoLabel}
              promoError={promoError}
            />
          </div>
        </div>
      </div>

      {/* Mobile-only floating cart pill: appears at the bottom of the
          Products tab as soon as anything is in the cart, lets the
          cashier jump to the cart without hunting for the tab switcher
          at the top. Hidden on desktop (where the cart is always
          visible in the right pane) and on the Cart tab itself. */}
      {activeTab === 'products' && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('cart')}
            className="flex w-full items-center justify-between gap-3 rounded-full bg-brand-600 px-5 py-3.5 text-white shadow-lg shadow-brand-600/30 active:bg-brand-700"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                <ShoppingCart className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">
                {lines.length} item · {formatIdrShort(total)}
              </span>
            </span>
            <span className="text-xs font-medium opacity-90">Lihat →</span>
          </button>
        </div>
      )}

      <UnitTierModal
        open={unitModalProduct != null}
        product={unitModalProduct}
        reservedInBase={
          unitModalProduct
            ? lines
                .filter(
                  (l) =>
                    l.itemId === unitModalProduct.id &&
                    !l.isAdhoc &&
                    l.ratioToBase != null,
                )
                .reduce((sum, l) => sum + l.qty * (l.ratioToBase ?? 0), 0)
            : 0
        }
        onClose={() => setUnitModalProduct(null)}
        onConfirm={(sel) => {
          if (!unitModalProduct) return
          const unit = unitModalProduct.units.find(
            (u) => u.unitId === sel.unitId,
          )
          if (!unit) return
          addOrMergeLine({
            product: unitModalProduct,
            unitId: sel.unitId,
            unitLabel: sel.unitLabel,
            ratioToBase: sel.ratioToBase,
            qty: sel.qty,
            unitPrice: sel.unitPrice,
            isBulk: sel.isBulk,
            tiers: unit.tiers,
          })
          setUnitModalProduct(null)
        }}
      />

      <VariantPickModal
        product={variantModalProduct}
        reservedByVariant={
          variantModalProduct
            ? lines.reduce<Record<string, number>>((acc, l) => {
                if (l.itemId === variantModalProduct.id && l.variantId) {
                  acc[l.variantId] =
                    (acc[l.variantId] ?? 0) + l.qty * (l.ratioToBase ?? 1)
                }
                return acc
              }, {})
            : {}
        }
        onClose={() => setVariantModalProduct(null)}
        onPick={(variant) => {
          if (!variantModalProduct) return
          addOrMergeLine({
            product: variantModalProduct,
            unitId: variantModalProduct.baseUnitId,
            unitLabel: variantModalProduct.baseUnitLabel,
            ratioToBase: 1,
            qty: 1,
            unitPrice: variant.price,
            isBulk: false,
            tiers: [],
            variantId: variant.id,
            variantLabel: variant.label,
            stockOverride: variant.stockInBase,
          })
          setVariantModalProduct(null)
        }}
      />

      <PaymentModal
        open={paymentOpen}
        total={total}
        allowedMethods={m.paymentMethods}
        customerId={customerId}
        customerKasbon={customerKasbon}
        onClose={() => setPaymentOpen(false)}
        onConfirm={(input) => create.mutate(input)}
        loading={create.isPending}
      />
      <AdhocLineModal
        open={adhocOpen}
        onClose={() => setAdhocOpen(false)}
        onAdd={addAdhoc}
      />
      <SaleSuccessModal
        open={!!successSale}
        saleId={successSale?.id ?? null}
        saleNumber={successSale?.number ?? null}
        customerPhone={successSale?.customerPhone}
        tenantName={tenantName}
        total={successSale?.total ?? 0}
        loyalty={successSale?.loyalty ?? null}
        onClose={() => {
          setSuccessSale(null)
          resetCart()
        }}
        onNewSale={() => {
          setSuccessSale(null)
          resetCart()
          router.invalidate()
        }}
      />
      {/* JUR-141 Peti Kas — blocking + lifecycle modals. Order
          matters: BukaKasModal is blocking (no Batal) so it wins
          when both showBukaKas and showStaleKas are true. In
          practice they're mutually exclusive (one needs no session,
          the other needs an open stale one). */}
      {showStaleKas && kasSession && (
        <StaleSessionModal
          sessionId={kasSession.id}
          openedAt={kasSession.openedAt}
          onForceClosed={refreshCashSession}
        />
      )}
      {showBukaKas && branchId && (
        <BukaKasModal
          branchId={branchId}
          branchName={m.branches.find((b) => b.id === branchId)?.name ?? ''}
          onOpened={refreshCashSession}
        />
      )}
      {setorTarikModal && kasSession && (
        <SetorTarikModal
          kind={setorTarikModal}
          sessionId={kasSession.id}
          onClose={() => setSetorTarikModal(null)}
          onSubmitted={refreshCashSession}
        />
      )}
      {tutupKasOpen && kasSession && (
        <TutupKasModal
          sessionId={kasSession.id}
          varianceThreshold={varianceThreshold}
          onClose={() => setTutupKasOpen(false)}
          onClosed={handleKasClosed}
        />
      )}
      {prepBatchProduct &&
        (() => {
          const defaultUnit =
            prepBatchProduct.units.find((u) => u.isDefault) ??
            prepBatchProduct.units[0]
          if (!defaultUnit) return null
          return (
            <PrepBatchSheet
              open={!!prepBatchProduct}
              onClose={() => setPrepBatchProduct(null)}
              item={{ id: prepBatchProduct.id, name: prepBatchProduct.name }}
              branchId={branchId}
              unit={{
                id: defaultUnit.unitId,
                label: defaultUnit.unitLabel,
                ratioToBase: defaultUnit.ratioToBase,
              }}
            />
          )
        })()}
    </div>
  )
}

/**
 * Variant picker for the cashier — taps a variant item, picks the
 * combo (each with its own price + remaining stock at this branch).
 * Flat list of combos (fast for cashiers); tapping adds qty 1 to the
 * cart and closes. `reservedByVariant` subtracts what's already in the
 * cart so the remaining-stock figure (and the disable) stays honest.
 */
function VariantPickModal({
  product,
  reservedByVariant,
  onClose,
  onPick,
}: {
  product: POSProduct | null
  reservedByVariant: Record<string, number>
  onClose: () => void
  onPick: (variant: POSVariant) => void
}) {
  if (!product) return null
  const variants = product.variants ?? []
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">
              {product.name}
            </h3>
            <p className="text-xs text-gray-500">Pilih variasi</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          {variants.map((v) => {
            const remaining = v.stockInBase - (reservedByVariant[v.id] ?? 0)
            const soldOut = remaining <= 0
            return (
              <button
                key={v.id}
                type="button"
                disabled={soldOut}
                onClick={() => onPick(v)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-brand-900/20"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {v.label}
                  </p>
                  <p className="text-xs text-gray-500">
                    {soldOut ? 'Stok habis' : `Stok: ${remaining}`}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-brand-700 dark:text-brand-300">
                  {formatRupiah(v.price)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * iOS-style segmented control button. Two of these go inside a grid
 * container with bg-gray-100, and the active one gets a white "pill"
 * appearance — familiar pattern from Tokopedia / Gojek tabs.
 */
function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md bg-white py-2 text-sm font-semibold text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
          : 'rounded-md py-2 text-sm font-medium text-gray-600 active:bg-gray-200 dark:text-gray-400 dark:active:bg-gray-700'
      }
    >
      {children}
    </button>
  )
}

/** Compact rupiah for the floating cart pill (full string is too long). */
function formatIdrShort(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

/** Match the highest tier whose `minQty` ≤ qty. Mirrors server-side. */
function retier(
  tiers: Array<{ minQty: number; unitPrice: number }>,
  qty: number,
): { minQty: number; unitPrice: number } | null {
  const matched = tiers
    .filter((t) => qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0]
  return matched ?? null
}

type StampCard = Awaited<ReturnType<typeof getCustomerStampCards>>[number]

/**
 * Project how many stamps each program would earn from the current
 * cart. Mirrors the server's per-line precedence in `createSale`:
 *
 *   1. single-product program (exact item match)
 *   2. product_set program (item in the set)
 *   3. category program (item's category matches)
 *
 * Lines already marked as a 100%-off reward (the cashier tapped "Tukar
 * gratis") are skipped — same as the server's stampConsumedLineIdx.
 * Used by the cashier to flip `canRedeem` once the in-progress cart
 * would fill the card, so a customer whose 5th-stamp purchase is on
 * the till right now can claim their reward immediately instead of
 * being told to come back next time.
 */
function projectStampEarn(
  lines: CartLine[],
  cards: StampCard[],
): Map<string, number> {
  if (cards.length === 0 || lines.length === 0) return new Map()
  const byProductId = new Map<string, StampCard>()
  const bySetItemId = new Map<string, StampCard>()
  const byCategoryId = new Map<string, StampCard>()
  for (const c of cards) {
    if (c.scope === 'product' && c.productId) {
      byProductId.set(c.productId, c)
    } else if (c.scope === 'product_set') {
      for (const id of c.setItemIds) {
        // First program wins (mirrors server's first-found semantics).
        if (!bySetItemId.has(id)) bySetItemId.set(id, c)
      }
    } else if (c.scope === 'category' && c.categoryId) {
      byCategoryId.set(c.categoryId, c)
    }
  }
  const earn = new Map<string, number>()
  for (const l of lines) {
    if (!l.itemId || l.isAdhoc) continue
    // 100%-off lines are reward lines (cashier's `redeemStamp` path);
    // mirror the server's stampConsumedLineIdx skip.
    if (
      l.lineDiscount?.type === 'percent' &&
      l.lineDiscount.value === 100
    ) {
      continue
    }
    const card =
      byProductId.get(l.itemId) ??
      bySetItemId.get(l.itemId) ??
      (l.categoryId ? byCategoryId.get(l.categoryId) : null)
    if (!card) continue
    const stamps = Math.floor(l.qty)
    if (stamps <= 0) continue
    earn.set(card.programId, (earn.get(card.programId) ?? 0) + stamps)
  }
  return earn
}

/**
 * Stamp card augmented with the per-program projection of how many
 * stamps the in-progress cart would earn. `canRedeem` here reflects
 * `currentStamps + projectedEarn >= stampsRequired` instead of the
 * server's stored balance, so a customer whose card fills on THIS
 * sale gets the redeem button immediately (see `projectStampEarn`).
 */
type AugmentedStampCard = StampCard & {
  projectedEarn: number
  projectedStamps: number
}

/**
 * JUR-195 — stamp-card strip above the cart. Shows the attached
 * customer's progress per program and a redeem button when a card is
 * full. Redeeming relies on the cashier having the reward item in the
 * cart already (the customer is buying that wash anyway).
 */
function StampRedeemPanel({
  cards,
  redeemedProgramIds,
  onRedeem,
  onCancel,
}: {
  cards: AugmentedStampCard[]
  redeemedProgramIds: string[]
  onRedeem: (card: StampCard) => void
  onCancel: (programId: string) => void
}) {
  return (
    <div className="mb-3 shrink-0 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-2 flex items-center gap-1.5">
        <Stamp className="h-3.5 w-3.5 text-brand-600" />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Kartu Stempel
        </span>
      </div>
      <ul className="space-y-2">
        {cards.map((c) => {
          const redeemed = redeemedProgramIds.includes(c.programId)
          return (
            <li
              key={c.programId}
              className="flex items-center justify-between gap-2"
            >
              {c.imageUrl && (
                <img
                  src={c.imageUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md border border-gray-200 object-cover dark:border-gray-700"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {c.programName}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {c.currentStamps}/{c.stampsRequired} stempel
                  {c.projectedEarn > 0 && !redeemed && (
                    <span className="text-brand-700 dark:text-brand-300">
                      {' · +'}
                      {c.projectedEarn} dari belanja ini
                    </span>
                  )}
                  {redeemed && ' · ditukar'}
                </p>
                {c.rewardMode === 'bundle' && c.bundleRewards.length > 0 && (
                  <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                    Hadiah:{' '}
                    {c.bundleRewards
                      .map((b) => `${b.quantity}× ${b.itemName}`)
                      .join(' + ')}
                  </p>
                )}
                {c.rewardMode === 'single' && c.rewardItemName && (
                  <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                    Hadiah: {c.rewardItemName}
                  </p>
                )}
              </div>
              {redeemed ? (
                <button
                  type="button"
                  onClick={() => onCancel(c.programId)}
                  className="shrink-0 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Batal tukar
                </button>
              ) : c.canRedeem ? (
                <button
                  type="button"
                  onClick={() => onRedeem(c)}
                  className="shrink-0 rounded-md bg-success-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-success-700"
                >
                  Tukar gratis
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

