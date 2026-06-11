/**
 * POS API hooks. Calls existing server fns:
 *   - getPOSCashierMasters → branches + categories + payment methods
 *   - listPOSProducts({ branchId, search?, categoryId?, page? }) → catalog
 *   - createSale → submits a sale (we only fill the required fields)
 *   - getSaleReceiptPDF → returns { dataUrl, fileName } for share/download
 *
 * Mobile v1 sale shape is intentionally minimal — we send only what
 * the server requires:
 *   - branchId
 *   - lines[]: { itemId, unitId, qty, unitPrice }
 *   - paymentMethod
 *   - paidAmount
 *
 * Everything else (customer, discount, loyalty, kasbon, promo, stamps)
 * is opt-in and skipped for v1. Web POS keeps the full feature set.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Cashier-masters shape (just the fields mobile actually reads) ──

export interface PosBranch {
  id: string
  name: string
}

export interface PosCategory {
  id: string
  name: string
}

export type PosPaymentMethod =
  | 'cash'
  | 'qris'
  | 'transfer'
  | 'card'
  | 'ewallet'
  | 'gopay'
  | 'shopeepay'
  | 'ovo'

export interface CashDrawerConfig {
  /** True only on Komplit tier with the tenant toggle on — gates Peti Kas. */
  enabled: boolean
  varianceThreshold: number
}

interface CashierMastersResponse {
  branches: PosBranch[]
  categories: PosCategory[]
  allowedPaymentMethods: PosPaymentMethod[]
  cashDrawer: CashDrawerConfig
}

export function useCashierMasters() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'cashier-masters', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<CashierMastersResponse>(
        'getPOSCashierMasters',
        {},
        { tenantId },
      ),
  })
}

// ─── Catalog ─────────────────────────────────────────────────────────

export interface PosUnit {
  unitId: string
  unitLabel: string
  ratioToBase: number
  isDefault: boolean
  tiers: Array<{ minQty: number; unitPrice: number }>
}

export interface PosProduct {
  id: string
  name: string
  sku: string | null
  baseUnitLabel: string
  photoKey: string | null
  /** Short-lived signed GET URL for the product photo, or null. */
  photoUrl: string | null
  categoryId: string | null
  stockInBase: number
  recipeBacked: boolean
  prepMode: boolean
  siapInBase: number | null
  isFavorite: boolean
  units: PosUnit[]
}

interface ListProductsResponse {
  items: PosProduct[]
}

interface ListProductsInput {
  branchId: string
  search?: string
  categoryId?: string
  page?: number
  pageSize?: number
}

export function useProducts(input: ListProductsInput) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'products', tenantId, input],
    enabled: !!tenantId && !!input.branchId,
    queryFn: () =>
      callServerFn<ListProductsResponse>(
        'listPOSProducts',
        input,
        { tenantId },
      ),
  })
}

export const POS_PAGE_SIZE = 20

/**
 * Paginated catalog for the cashier grid (infinite scroll). The server
 * returns only `{ items }`, so "has more" is inferred from a full page:
 * a short page means we've reached the end.
 */
export function useInfiniteProducts(input: {
  branchId: string
  search?: string
  categoryId?: string
}) {
  const { tenantId } = useTenant()
  return useInfiniteQuery({
    queryKey: ['pos', 'products-infinite', tenantId, input],
    enabled: !!tenantId && !!input.branchId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      callServerFn<ListProductsResponse>(
        'listPOSProducts',
        { ...input, page: pageParam, pageSize: POS_PAGE_SIZE },
        { tenantId },
      ),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === POS_PAGE_SIZE ? allPages.length + 1 : undefined,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Default unit + tier used when adding a product to the cart from a
 * single tap (no unit picker on mobile v1). Picks:
 *   - the unit marked `isDefault`, falling back to the first unit
 *   - that unit's smallest-min-qty tier (cheapest entry-point price)
 *
 * Returns null when the item has no priced units (shouldn't happen
 * — the catalog filters those out — but defensive against drift).
 */
export function pickDefaultPricing(
  product: PosProduct,
): { unit: PosUnit; tier: { minQty: number; unitPrice: number } } | null {
  const unit = product.units.find((u) => u.isDefault) ?? product.units[0]
  if (!unit || unit.tiers.length === 0) return null
  const tier =
    [...unit.tiers].sort((a, b) => a.minQty - b.minQty)[0] ?? unit.tiers[0]!
  return { unit, tier }
}

// ─── Sale submission ─────────────────────────────────────────────────

export interface SaleLine {
  itemId: string
  unitId: string
  qty: number
  unitPrice: number
}

interface CreateSaleInput {
  branchId: string
  lines: SaleLine[]
  paymentMethod: PosPaymentMethod
  paidAmount: number
  /** Optional customer attachment — server upserts by phone. */
  customerName?: string | null
  customerPhone?: string | null
  /** Loyalty redemption — points to spend on this sale. Requires customer. */
  redeemPoints?: number | null
  /** Stamp programs to redeem rewards from. Requires customer + free lines. */
  stampRedemptions?: string[] | null
}

interface CreateSaleResponse {
  id: string
  saleNumber: string
  total: number
}

export function useCreateSale() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSaleInput) =>
      callServerFn<CreateSaleResponse>('createSale', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos'] })
    },
  })
}

// ─── Today's sales overview ──────────────────────────────────────────

export interface PosOverviewToday {
  salesCount: number
  revenue: number
  avgTicket: number
}

export type PosTier = 'free' | 'toko' | 'komplit' | 'bisnis' | string

interface PosOverviewResponse {
  tier: PosTier
  caps: {
    salesPerDayCap: number | null
    cashierCap: number | null
    branchCap: number | null
    historyDays: number | null
  }
  today: PosOverviewToday
}

export function usePosOverview(opts?: {
  enabled?: boolean
  /** Optional outlet scope from the global outlet switcher. Omit for
   *  the member's full allowed-branch set (matches web behavior). */
  branchId?: string | null
}) {
  const { tenantId } = useTenant()
  const branchId = opts?.branchId ?? null
  return useQuery({
    queryKey: ['pos', 'overview', tenantId, branchId],
    enabled: !!tenantId && (opts?.enabled ?? true),
    queryFn: () =>
      callServerFn<PosOverviewResponse>(
        'getPOSOverview',
        branchId ? { branchId } : {},
        { tenantId },
      ),
    refetchOnWindowFocus: true,
  })
}

// ─── Sale detail + void ─────────────────────────────────────────────

export interface SaleLineItem {
  id: string
  itemId: string | null
  productName: string
  unitLabel: string
  qty: string
  unitPrice: string
  lineTotal: string
  notes: string | null
}

export interface SaleDetail {
  id: string
  saleNumber: string
  createdAt: string
  branchId: string
  branchName: string
  status: 'completed' | 'voided' | string
  subtotal: string
  discountAmount: string
  discountType: 'percent' | 'amount' | null
  discountValue: string | null
  taxAmount: string
  total: string
  paymentMethod: PosPaymentMethod
  paidAmount: string
  changeAmount: string
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  voidReason: string | null
  voidedAt: string | null
  items: SaleLineItem[]
}

export function useSaleDetail(saleId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'sale', tenantId, saleId],
    enabled: !!tenantId && !!saleId,
    queryFn: () =>
      callServerFn<SaleDetail>('getSale', { id: saleId }, { tenantId }),
  })
}

export interface VoidCategory {
  id: string
  label: string
  isSystem: boolean
  isActive: boolean
}

export function useVoidCategories(enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'void-categories', tenantId],
    enabled: !!tenantId && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      callServerFn<VoidCategory[]>('listVoidCategories', {}, { tenantId }),
  })
}

interface VoidSaleInput {
  id: string
  reason: string
  categoryId: string
}

export function useVoidSale() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: VoidSaleInput) =>
      callServerFn<SaleDetail>('voidSale', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos'] })
    },
  })
}

// ─── Loyalty stamp programs (Komplit) ──────────────────────────────

export type StampScope = 'category' | 'product' | 'product_set'
export type StampRewardMode = 'single' | 'bundle'

export interface StampProgramRow {
  id: string
  name: string
  scope: StampScope | string
  categoryId: string | null
  categoryName: string | null
  productId: string | null
  productName: string | null
  stampsRequired: number
  rewardMode: StampRewardMode | string
  rewardItemId: string | null
  rewardItemName: string | null
  imageKey: string | null
  isActive: boolean
  createdAt: string
  scopeItems?: Array<{ itemId: string; itemName: string }>
  rewardBundleItems?: Array<{ itemId: string; itemName: string; quantity: number }>
}

export interface StampFormMasters {
  categories: Array<{ id: string; name: string }>
  items: Array<{ id: string; name: string }>
}

export function useStampPrograms() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'stamp-programs', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<StampProgramRow[]>('listStampPrograms', {}, { tenantId }),
  })
}

export function useStampFormMasters(enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'stamp-form-masters', tenantId],
    enabled: !!tenantId && enabled,
    queryFn: () =>
      callServerFn<StampFormMasters>(
        'getStampFormMasters',
        {},
        { tenantId },
      ),
  })
}

interface UpsertStampInput {
  id?: string
  name: string
  scope: StampScope
  categoryId?: string | null
  productId?: string | null
  itemIds?: string[]
  stampsRequired: number
  rewardMode: StampRewardMode
  rewardItemId?: string | null
  bundleItems?: Array<{ itemId: string; quantity: number }>
  isActive?: boolean
}

export function useCreateStampProgram() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertStampInput) =>
      callServerFn<StampProgramRow>(
        'createStampProgram',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'stamp-programs'] })
    },
  })
}

export function useUpdateStampProgram() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertStampInput & { id: string }) =>
      callServerFn<StampProgramRow>(
        'updateStampProgram',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'stamp-programs'] })
    },
  })
}

export function useDeleteStampProgram() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteStampProgram',
        { id },
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'stamp-programs'] })
    },
  })
}

// ─── Promotions (Komplit) ───────────────────────────────────────────

export type PromoScope = 'code' | 'product' | 'multi_product' | 'category' | 'cart'

export interface PromoRow {
  id: string
  name: string
  code: string | null
  triggerType: PromoScope | string
  discountType: 'percent' | 'fixed' | string
  discountValue: string
  maxDiscountAmount: string | null
  minCartTotal: string | null
  startsAt: string | null
  endsAt: string | null
  totalRedemptionCap: number | null
  perCustomerCap: number | null
  isActive: boolean
  imageKey: string | null
  itemTargets: Array<{ id: string; name: string }>
  categoryTargets: Array<{ id: string; name: string }>
}

interface ListPromotionsResponse {
  promotions: PromoRow[]
  total: number
}

export function usePromotions(includeInactive = false) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'promotions', tenantId, includeInactive],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<ListPromotionsResponse | PromoRow[]>(
        'listPromotions',
        { includeInactive },
        { tenantId },
      ).then((res) =>
        Array.isArray(res)
          ? { promotions: res, total: res.length }
          : (res as ListPromotionsResponse),
      ),
  })
}

interface UpsertPromoInput {
  id?: string
  name: string
  scope: PromoScope
  code?: string | null
  itemIds?: string[]
  categoryIds?: string[]
  discountType: 'percent' | 'fixed'
  discountValue: number
  maxDiscountAmount?: number | null
  minCartTotal?: number | null
  startsAt?: string | null
  endsAt?: string | null
  totalRedemptionCap?: number | null
  perCustomerCap?: number | null
  isActive?: boolean
}

export function useUpsertPromotion() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertPromoInput) =>
      callServerFn<PromoRow>('upsertPromotion', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'promotions'] })
    },
  })
}

export function useDeactivatePromotion() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deactivatePromotion',
        { id },
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'promotions'] })
    },
  })
}

export interface PromoProductOption {
  id: string
  name: string
  baseUnitLabel: string
  sellingPrice: string
}

export function useSellablePromoProducts(search?: string) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'promo-products', tenantId, search],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<PromoProductOption[]>(
        'listSellablePromoProducts',
        search ? { search } : {},
        { tenantId },
      ),
  })
}

// ─── POS settings ───────────────────────────────────────────────────

export interface POSTaxRow {
  id: string
  name: string
  ratePct: number
  isActive: boolean
}

export interface POSSettingsRow {
  tenantId: string
  taxes: POSTaxRow[] | null
  receiptFooterText: string | null
  defaultPaymentMethods: PosPaymentMethod[] | null
  loyaltyEnabled: boolean
  loyaltyEarnMode: 'linear' | 'step' | string
  loyaltyEarnRate: string
  loyaltyEarnStepAmount: string
  loyaltyEarnStepPoints: string
  loyaltyRedeemRate: string
  cashDrawerEnabled: boolean
  cashVarianceThreshold: number
}

export interface POSSettingsBranch {
  id: string
  name: string
  receiptFooterText: string | null
  receiptLogoKey: string | null
}

interface POSSettingsResponse {
  tier: PosTier
  settings: POSSettingsRow | null
  branches: POSSettingsBranch[]
  limits: {
    paymentMethods: PosPaymentMethod[]
    features: string[]
    salesPerDayCap: number | null
    cashierCap: number | null
    branchCap: number | null
    historyDays: number | null
  }
}

export function usePOSSettings() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'settings', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<POSSettingsResponse>('getPOSSettings', {}, { tenantId }),
  })
}

interface UpdatePOSSettingsInput {
  taxes?: POSTaxRow[]
  receiptFooterText?: string | null
  defaultPaymentMethods?: PosPaymentMethod[]
  loyaltyEnabled?: boolean
  loyaltyEarnMode?: 'linear' | 'step'
  loyaltyEarnRate?: number
  loyaltyEarnStepAmount?: number
  loyaltyEarnStepPoints?: number
  loyaltyRedeemRate?: number
}

export function useUpdatePOSSettings() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdatePOSSettingsInput) =>
      callServerFn<{ success: true }>('updatePOSSettings', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos'] })
    },
  })
}

interface UpdateCashSettingsInput {
  cashDrawerEnabled?: boolean
  cashVarianceThreshold?: number
}

export function useUpdatePOSCashSettings() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCashSettingsInput) =>
      callServerFn<{ success: true }>(
        'updatePOSCashSettings',
        input,
        { tenantId },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos'] })
    },
  })
}

interface UpsertVoidCategoryInput {
  id?: string
  label: string
  isActive?: boolean
}

export function useCreateVoidCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertVoidCategoryInput) =>
      callServerFn<VoidCategory>('createVoidCategory', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'void-categories'] })
    },
  })
}

export function useUpdateVoidCategory() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertVoidCategoryInput & { id: string }) =>
      callServerFn<VoidCategory>('updateVoidCategory', input, { tenantId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', 'void-categories'] })
    },
  })
}

// ─── Prep & Waste report ────────────────────────────────────────────

export interface PrepWasteRow {
  day: string
  itemId: string
  itemName: string
  branchId: string
  branchName: string
  baseUnitLabel: string
  qtyPrepared: number
  qtyConsumed: number
  qtyLeftover: number
}

interface PrepWasteInput {
  dateFrom: string
  dateTo: string
  branchId?: string
}

export function usePrepWasteReport(input: PrepWasteInput, enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['pos', 'prep-waste', tenantId, input],
    enabled: !!tenantId && enabled && !!input.dateFrom && !!input.dateTo,
    queryFn: () =>
      callServerFn<PrepWasteRow[]>('getPrepWasteReport', input, { tenantId }),
  })
}

// ─── Receipt PDF ─────────────────────────────────────────────────────

interface ReceiptPdfResponse {
  dataUrl: string
  fileName: string
}

export function useReceiptPdf() {
  const { tenantId } = useTenant()
  return useMutation({
    mutationFn: (saleId: string) =>
      callServerFn<ReceiptPdfResponse>(
        'getSaleReceiptPDF',
        { id: saleId, layout: 'thermal-80mm' },
        { tenantId },
      ),
  })
}
