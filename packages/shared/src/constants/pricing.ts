import type { ModuleKey } from './modules'

/**
 * A single billing plan tier for a paid module.
 *
 * For attendance the unit is per-staff-per-month: the landing page quotes
 * prices per staff/month and the admin finance flow computes
 * `durationMonths × pricePerStaffPerMonth × staffCount` when the admin
 * records a payment. Future modules (POS, inventory) will extend this
 * shape or introduce a new one as their billing model solidifies.
 */
export interface PlanTier {
  key: string
  moduleKey: ModuleKey
  durationMonths: number
  /** IDR per staff per month (integer rupiah, no fractional currency). */
  pricePerStaffPerMonth: number
  labelKey: string
  /** "Hemat X%" pill on marketing surfaces. Absent on the base tier. */
  savingsLabel?: string
  /** Highlight as the recommended tier. At most one per module. */
  popular?: boolean
}

/**
 * Attendance pricing — shared source of truth for:
 *   - landing page pricing grid (`apps/web/src/routes/index.tsx`)
 *   - admin activate/renew form (`apps/web/src/components/admin/finance/payment-sheet.tsx`)
 *   - server-side validation in `recordPaymentAndActivate`
 *
 * Changing prices = code deploy (intentional — manual-billing era).
 */
export const ATTENDANCE_PLANS: readonly PlanTier[] = [
  {
    key: 'attendance_1mo',
    moduleKey: 'attendance',
    durationMonths: 1,
    pricePerStaffPerMonth: 8000,
    labelKey: 'pricing.planMonthly',
  },
  {
    key: 'attendance_3mo',
    moduleKey: 'attendance',
    durationMonths: 3,
    pricePerStaffPerMonth: 7000,
    labelKey: 'pricing.plan3mo',
    savingsLabel: '12%',
  },
  {
    key: 'attendance_6mo',
    moduleKey: 'attendance',
    durationMonths: 6,
    pricePerStaffPerMonth: 6000,
    labelKey: 'pricing.plan6mo',
    savingsLabel: '25%',
  },
  {
    key: 'attendance_12mo',
    moduleKey: 'attendance',
    durationMonths: 12,
    pricePerStaffPerMonth: 5000,
    labelKey: 'pricing.plan12mo',
    savingsLabel: '37%',
    popular: true,
  },
]

export function findPlan(planKey: string): PlanTier | null {
  return ATTENDANCE_PLANS.find((p) => p.key === planKey) ?? null
}

/**
 * Default length + staff cap when admin starts a trial without overriding.
 * Admin can still pick different values per tenant via the TrialSheet.
 * `staffCap: null` means UNLIMITED — gates treat null as no cap so the
 * tenant can add as many staff as they want during trial. The admin
 * UI lets the platform admin override with a specific number if they
 * want a hard ceiling for a particular tenant.
 */
export const ATTENDANCE_TRIAL_DEFAULTS = {
  durationDays: 14,
  staffCap: null as number | null,
} as const

/**
 * Special trial "plan" — lives outside ATTENDANCE_PLANS so it doesn't
 * appear in the paid-plan picker on the admin PaymentSheet, but is
 * still resolvable via `findAnyPlan` when we need a display label for
 * a trial transaction row.
 */
export const TRIAL_PLAN: PlanTier = {
  key: 'attendance_trial',
  moduleKey: 'attendance',
  // Trial is days-based, not months; durationMonths=0 is a sentinel.
  // Callers that care about trial duration should read
  // attendance_settings.trial_ends_at directly, not this field.
  durationMonths: 0,
  pricePerStaffPerMonth: 0,
  labelKey: 'pricing.planTrial',
}

/**
 * Resolve any plan including trial. Use this for DISPLAY (plan labels
 * in overview, billing history, etc.). Use `findPlan` when building a
 * paid-plan picker — trial shouldn't show up there.
 */
export function findAnyPlan(planKey: string): PlanTier | null {
  if (planKey === TRIAL_PLAN.key) return TRIAL_PLAN
  return findPlan(planKey)
}

/**
 * Total billing amount in IDR for an attendance plan.
 * Throws on unknown planKey — caller should validate input.
 */
export function attendanceTotal(planKey: string, staffCount: number): number {
  const plan = findPlan(planKey)
  if (!plan) throw new Error(`Unknown attendance plan: ${planKey}`)
  return plan.pricePerStaffPerMonth * plan.durationMonths * staffCount
}

// ─── Inventory module ────────────────────────────────────────────────
//
// Inventory is flat-priced PER TENANT (not per-staff like attendance),
// and each tier carries hard caps (SKU + branch + history retention)
// plus a feature flag set. Two parallel shapes coexist with attendance
// rather than forcing both into one — billing models for the two
// modules are different enough that bending one to fit the other
// would just create a god-interface that's neither.

export type InventoryFeatureFlag =
  | 'multi_unit'
  | 'suppliers_po'
  | 'low_stock_alerts'
  | 'hpp_sync_bidirectional'
  | 'variants' // Phase 2
  | 'batch_expiry' // Phase 2
  | 'barcode' // Phase 2
  | 'cogs_report' // Phase 2
  | 'inter_outlet_transfer' // Phase 3

/**
 * Inventory tier keys. The `multi_outlet` flat tier was retired in
 * favour of additive per-location pricing on Toko + Bisnis — matches
 * the POS model and lets warehouse-only "gudang" branches be billed
 * à la carte at the Inventory rate (cheaper than the full bundled
 * Komplit extra-outlet fee). DB still constrains all 4 values via the
 * `inventory_tier_chk` so old data doesn't break; code-side the union
 * shrinks to keep new callers from selecting the retired tier.
 */
export type InventoryTierKey = 'free' | 'toko' | 'bisnis'

/** Flat-rate plan (per tenant, not per staff). */
export interface InventoryTier {
  key: string // 'inventory_free' | 'inventory_toko_monthly' | ...
  moduleKey: 'inventory'
  tier: InventoryTierKey
  durationMonths: number // 0 for free, 1 monthly, 12 annual
  /** Flat IDR per month for the FIRST inventory location. */
  pricePerMonth: number
  /**
   * IDR per month for each additional inventory location (branch with
   * `enabledModules` including 'inventory') beyond the first. 0 for
   * free (which is hard-capped at 1 location anyway). Mirrors POS's
   * `additionalOutletPerMonth` so the cost-preview math on
   * /master/branches reads consistently across modules.
   */
  additionalLocationPerMonth: number
  /** null = unlimited. */
  skuCap: number | null
  branchCap: number | null
  /** Movement history retention in days. null = unlimited. */
  movementHistoryDays: number | null
  features: ReadonlyArray<InventoryFeatureFlag>
  labelKey: string
  savingsLabel?: string
  popular?: boolean
  /** Render disabled with a "Coming Soon" badge until that phase ships. */
  comingSoon?: boolean
}

const TOKO_FEATURES: ReadonlyArray<InventoryFeatureFlag> = [
  'multi_unit',
  'suppliers_po',
  'low_stock_alerts',
  'hpp_sync_bidirectional',
]

const BISNIS_FEATURES: ReadonlyArray<InventoryFeatureFlag> = [
  ...TOKO_FEATURES,
  'variants',
  'batch_expiry',
  'barcode',
  'cogs_report',
]

// `inter_outlet_transfer` rolls up into Bisnis (Phase 3): multi-outlet
// chains who need transfers should be on Bisnis with per-location
// add-ons. The standalone multi_outlet flat tier was retired — see
// `InventoryTierKey` comment for context.
const BISNIS_PLUS_FEATURES: ReadonlyArray<InventoryFeatureFlag> = [
  ...BISNIS_FEATURES,
  'inter_outlet_transfer',
]

/**
 * Inventory pricing — single source of truth for landing page,
 * admin payment flow, server validation, and tier-cap enforcement.
 *
 * Phase 1 ships Free + Toko features. Bisnis is declared with
 * `comingSoon: true` so the landing page can show it but disable
 * purchase. Per-location pricing is additive on Toko + Bisnis (same
 * shape as POS); the retired multi_outlet flat tier was never sold.
 */
export const INVENTORY_PLANS: readonly InventoryTier[] = [
  {
    key: 'inventory_free',
    moduleKey: 'inventory',
    tier: 'free',
    durationMonths: 0,
    pricePerMonth: 0,
    additionalLocationPerMonth: 0,
    // Lifted from 25 → unlimited so Free tier matches Qasir's "no SKU
    // limit" promise. Conversion to paid still has real differentiation
    // (multi-unit pricing, PO + suppliers, low-stock alerts, HPP sync),
    // and storage is genuinely free at our scale (DB rows + S3 photos
    // are <Rp 1k/year per free tenant). See unit-economics analysis.
    skuCap: null,
    branchCap: 1,
    movementHistoryDays: 30,
    features: [],
    labelKey: 'pricing.inventoryFree',
  },
  {
    key: 'inventory_toko_monthly',
    moduleKey: 'inventory',
    tier: 'toko',
    durationMonths: 1,
    pricePerMonth: 49000,
    // +Rp 25k/extra inventory location. Cheaper than POS's Rp 50k
    // extra-outlet because warehouses don't need POS terminals / staff
    // / payment plumbing — they just hold stock.
    additionalLocationPerMonth: 25000,
    skuCap: null,
    branchCap: null,
    movementHistoryDays: null,
    features: TOKO_FEATURES,
    labelKey: 'pricing.inventoryTokoMonthly',
  },
  {
    key: 'inventory_toko_annual',
    moduleKey: 'inventory',
    tier: 'toko',
    durationMonths: 12,
    pricePerMonth: 39000,
    additionalLocationPerMonth: 20000,
    skuCap: null,
    branchCap: null,
    movementHistoryDays: null,
    features: TOKO_FEATURES,
    labelKey: 'pricing.inventoryTokoAnnual',
    savingsLabel: '20%',
    popular: true,
  },
  {
    key: 'inventory_bisnis_monthly',
    moduleKey: 'inventory',
    tier: 'bisnis',
    durationMonths: 1,
    pricePerMonth: 99000,
    additionalLocationPerMonth: 50000,
    skuCap: null,
    branchCap: null,
    movementHistoryDays: null,
    features: BISNIS_PLUS_FEATURES,
    labelKey: 'pricing.inventoryBisnisMonthly',
    comingSoon: true,
  },
  {
    key: 'inventory_bisnis_annual',
    moduleKey: 'inventory',
    tier: 'bisnis',
    durationMonths: 12,
    pricePerMonth: 79000,
    additionalLocationPerMonth: 40000,
    skuCap: null,
    branchCap: null,
    movementHistoryDays: null,
    features: BISNIS_PLUS_FEATURES,
    labelKey: 'pricing.inventoryBisnisAnnual',
    savingsLabel: '20%',
    comingSoon: true,
  },
]

/** Default trial duration when admin starts an inventory trial. */
export const INVENTORY_TRIAL_DEFAULTS = {
  durationDays: 7,
  /** Trial unlocks Toko-tier features. */
  tier: 'toko' as InventoryTierKey,
} as const

/** Trial pseudo-plan for ledger display. */
export const INVENTORY_TRIAL_PLAN: InventoryTier = {
  key: 'inventory_trial',
  moduleKey: 'inventory',
  tier: 'toko',
  durationMonths: 0,
  pricePerMonth: 0,
  additionalLocationPerMonth: 0,
  // Trial inherits the new unlimited SKU cap from Toko.
  skuCap: null,
  branchCap: null,
  movementHistoryDays: null,
  features: TOKO_FEATURES,
  labelKey: 'pricing.inventoryTrial',
}

export function findInventoryPlan(planKey: string): InventoryTier | null {
  return INVENTORY_PLANS.find((p) => p.key === planKey) ?? null
}

export function findAnyInventoryPlan(planKey: string): InventoryTier | null {
  if (planKey === INVENTORY_TRIAL_PLAN.key) return INVENTORY_TRIAL_PLAN
  return findInventoryPlan(planKey)
}

/** Plan limits for a given resolved tier (cap + features). */
export function inventoryTierLimits(
  tier: InventoryTierKey,
): Pick<InventoryTier, 'skuCap' | 'branchCap' | 'movementHistoryDays' | 'features'> {
  // Pick the first non-comingSoon plan with this tier (free tier or
  // monthly variant). Annual + monthly share the same limits.
  const plan =
    INVENTORY_PLANS.find((p) => p.tier === tier && !p.comingSoon) ??
    INVENTORY_PLANS.find((p) => p.tier === tier)
  if (!plan) {
    // Fall back to free safely.
    return {
      skuCap: 25,
      branchCap: 1,
      movementHistoryDays: 30,
      features: [],
    }
  }
  return {
    skuCap: plan.skuCap,
    branchCap: plan.branchCap,
    movementHistoryDays: plan.movementHistoryDays,
    features: plan.features,
  }
}

/**
 * Total billing amount in IDR for an inventory plan.
 *
 * Bill = base × months + extra-locations × per-location × months
 * where extra = max(0, locationCount - 1). The first location is
 * included in the base price; only locations BEYOND the first cost
 * extra. Matches `posTotal` shape so admin finance flows compute
 * uniformly.
 *
 * `locationCount` defaults to 1 so old call sites stay correct without
 * a code change — they'll bill the single-location rate (the case for
 * almost every Inventory subscriber today).
 */
export function inventoryTotal(
  planKey: string,
  locationCount: number = 1,
): number {
  const plan = findInventoryPlan(planKey)
  if (!plan) throw new Error(`Unknown inventory plan: ${planKey}`)
  const safeCount = Math.max(1, Math.floor(locationCount))
  const extra = safeCount - 1
  return (
    plan.pricePerMonth * plan.durationMonths +
    extra * plan.additionalLocationPerMonth * plan.durationMonths
  )
}

// ─── POS module ──────────────────────────────────────────────────────
//
// POS is flat-priced PER TENANT (not per-staff like attendance), and
// each tier carries hard caps (sales/day, cashiers, branches, history)
// plus a feature flag set + allowed payment methods. Mirrors the
// inventory pricing shape — same `tier` enum, same coming-soon pattern
// for Bisnis + Multi-Outlet — so the landing page renders all four
// cards but only Free + Toko are actually purchasable in Phase 1.

export type POSPaymentMethod =
  | 'cash'
  | 'qris'
  | 'transfer'
  | 'card'
  | 'ewallet'
  | 'gopay'
  | 'shopeepay'
  | 'ovo'

export type POSFeatureFlag =
  | 'custom_receipt'
  | 'sale_discount'
  | 'customer_capture'
  | 'daily_zreport'
  | 'pl_report' // JUR-11 (W5) — Toko+: P&L / monthly report (custom date ranges)
  | 'ingredient_consumption' // JUR-10 (W4) — Toko+: auto-deduct BOM ingredients on sale
  | 'line_discount' // JUR-7 (W1) — Toko+: per-line discount on cart
  | 'promo_codes' // JUR-9 (W3) — Komplit only: tenant promotions (codes + auto_product + auto_cart)
  | 'customer_db' // Phase 2
  | 'loyalty_points' // JUR-8 (W2) — Komplit only: earn + redeem points
  | 'kitchen_display' // Phase 2
  | 'shift_management' // Phase 2
  | 'cross_outlet_reports' // Phase 3
  // JUR-176 — Komplit only: tenant public site builder + analytics +
  // claimable `<slug>.vintra.my.id` URL. Free/Toko tenants can't see
  // the Situs sidebar entry, can't claim a public slug, and a tenant
  // who downgrades has their public URL go dark (404).
  | 'tenant_site'
  // JUR-12 — Toko + Komplit: Web Bluetooth thermal printer (58mm/80mm,
  // ESC/POS over BLE GATT). Free tier keeps the PDF receipt path so
  // owners still have a print option without paying — the BT driver
  // is the upgrade hook (most merchants ask for "cetak struk" specifically).
  | 'thermal_printer'
  // JUR-155 — Komplit only: Cashflow Monitoring (manual income/expense
  // ledger in Phase 1; POS auto-import + AR/AP in later phases). Bundled
  // into Komplit as a retention play, not sold as a separate SKU.
  | 'cashflow'

export type POSTierKey =
  | 'free'
  | 'toko'
  | 'bisnis'
  | 'multi_outlet'
  /**
   * Komplit bundle (JUR-5b). One SKU bundles POS Toko + Inventory Toko
   * + Attendance (unlimited staff) + HPP. Phase 2 features (loyalty,
   * promo codes, line discount, kitchen display, shift management)
   * are listed in `POS_KOMPLIT_FEATURES` so the bundle "includes"
   * them on paper; each feature gates its own server function and
   * lights up as it ships through W2-W6.
   */
  | 'komplit'

/**
 * POS plan. Pricing follows the Qasir model: a flat base price covers
 * 1 outlet (the typical 1-warung tenant), and additional outlets cost
 * extra per month. Lets us match Qasir's headline price for the most
 * common case (Rp 79k/month for one outlet) while still scaling
 * revenue with multi-outlet chains.
 *
 * For computing the actual bill at admin time:
 *   total = pricePerMonth × durationMonths
 *         + (outletCount - 1) × additionalOutletPerMonth × durationMonths
 *
 * Free tier: salesPerDayCap = null (unlimited transactions),
 * historyDays = null (unlimited history). Conversion comes from
 * branch/cashier/feature gates, not from artificial caps that would
 * frustrate medium-volume free users.
 */
export interface POSTier {
  key: string // 'pos_free' | 'pos_toko_monthly' | ...
  moduleKey: 'pos'
  tier: POSTierKey
  durationMonths: number // 0 for free, 1 monthly, 12 annual
  /** Flat IDR per month for the FIRST outlet. */
  pricePerMonth: number
  /**
   * IDR per month for each additional outlet beyond the first.
   * 0 for the free tier (which is hard-capped at 1 outlet anyway).
   */
  additionalOutletPerMonth: number
  /** null = unlimited (free tier finally got unlimited tx — matches market). */
  salesPerDayCap: number | null
  cashierCap: number | null
  /** null = unlimited (paid tiers). Free pins to a single branch. */
  branchCap: number | null
  /** null = unlimited (now also for free — merchants expect this). */
  historyDays: number | null
  paymentMethods: ReadonlyArray<POSPaymentMethod>
  features: ReadonlyArray<POSFeatureFlag>
  labelKey: string
  savingsLabel?: string
  popular?: boolean
  /** Render disabled with a "Coming Soon" badge until that phase ships. */
  comingSoon?: boolean
}

const POS_FREE_PAYMENT_METHODS: ReadonlyArray<POSPaymentMethod> = ['cash', 'qris']
const POS_ALL_PAYMENT_METHODS: ReadonlyArray<POSPaymentMethod> = [
  'cash',
  'qris',
  'transfer',
  'card',
  'ewallet',
  'gopay',
  'shopeepay',
  'ovo',
]

const POS_TOKO_FEATURES: ReadonlyArray<POSFeatureFlag> = [
  'custom_receipt',
  'sale_discount',
  'customer_capture',
  'daily_zreport',
  // Customer DB (JUR-6) — Toko gets the customer table + autocomplete;
  // loyalty (W2) and promo (W3) layer on top in Komplit/Bisnis.
  'customer_db',
  // Ingredient auto-deduction (JUR-10) — kafe-friendly even at à-la-carte
  // Toko price; HPP recipes are free to configure for everyone, but the
  // consumption wiring activates only on Toko+ POS.
  'ingredient_consumption',
  // Line-level discount (JUR-7) — basic POS functionality (one item
  // gets 10% off, others stay full price). Stays out of Free to keep
  // a clear upgrade reason for tukang lapak / pasar tenants who need
  // it daily.
  'line_discount',
  // P&L / monthly report (JUR-11) — owner-facing aggregations for any
  // custom date range. Free still gets the daily Z-report; this is
  // the bigger sibling that surfaces gross margin + top items + by-
  // cashier + by-payment-method splits.
  'pl_report',
  // Web Bluetooth thermal printer (JUR-12).
  'thermal_printer',
]

const POS_BISNIS_FEATURES: ReadonlyArray<POSFeatureFlag> = [
  ...POS_TOKO_FEATURES,
  'line_discount',
  'promo_codes',
  'customer_db',
  'kitchen_display',
  'shift_management',
]

const POS_MULTI_OUTLET_FEATURES: ReadonlyArray<POSFeatureFlag> = [
  ...POS_BISNIS_FEATURES,
  'cross_outlet_reports',
]

/**
 * Komplit bundle features. Same advanced feature set as Bisnis (loyalty,
 * promo, line discount, etc.) PLUS bundles inventory + attendance
 * activation in the same payment. The features that haven't shipped yet
 * (line_discount, promo_codes, kitchen_display, shift_management) are
 * declared in this list so subscribed tenants get them automatically
 * when the actual code lands during W2-W5; until then the per-feature
 * server gate throws a "Coming Soon" error.
 *
 * `loyalty_points` is Komplit-exclusive per JUR-8 — Bisnis does not get
 * it. Loyalty is the headline differentiator that justifies the bundle
 * over standalone Toko/Bisnis.
 */
const POS_KOMPLIT_FEATURES: ReadonlyArray<POSFeatureFlag> = [
  ...POS_BISNIS_FEATURES,
  'loyalty_points',
  // Tenant promotions (JUR-9) — codes + product auto-apply + cart
  // auto-apply, all in one schema. Komplit-exclusive headline along
  // with loyalty.
  'promo_codes',
  // Tenant public site (JUR-176) — Situs editor + section builder +
  // claimable `<slug>.vintra.my.id` URL + visit analytics. Bundled
  // into Komplit so the headline reads "punya halaman web sendiri,
  // sudah termasuk".
  'tenant_site',
  // Cashflow Monitoring (JUR-155) — manual ledger in Phase 1.
  'cashflow',
]

/**
 * POS pricing — single source of truth for landing page, admin payment
 * flow, server validation, and tier-cap enforcement.
 *
 * Phase 1 ships Free + Toko features. Bisnis + Multi-Outlet are
 * declared with `comingSoon: true` so the landing page can show all
 * four tiers but disable purchase. Their feature flags are listed
 * for future use; the server-side gate checks regardless of tier.
 */
export const POS_PLANS: readonly POSTier[] = [
  {
    key: 'pos_free',
    moduleKey: 'pos',
    tier: 'free',
    durationMonths: 0,
    pricePerMonth: 0,
    additionalOutletPerMonth: 0,
    salesPerDayCap: null,
    cashierCap: 1,
    branchCap: 1,
    historyDays: null,
    paymentMethods: POS_FREE_PAYMENT_METHODS,
    features: [],
    labelKey: 'pricing.posFree',
  },
  {
    // Toko monthly (POS-only à-la-carte). Same as before.
    key: 'pos_toko_monthly',
    moduleKey: 'pos',
    tier: 'toko',
    durationMonths: 1,
    pricePerMonth: 79000,
    additionalOutletPerMonth: 50000,
    salesPerDayCap: null,
    cashierCap: 3,
    branchCap: null,
    historyDays: null,
    paymentMethods: POS_ALL_PAYMENT_METHODS,
    features: POS_TOKO_FEATURES,
    labelKey: 'pricing.posTokoMonthly',
  },
  {
    // Toko annual (POS-only) — Rp 49k/month effective (Rp 588k/year).
    // Beats Qasir Pro's Rp 700k headline by Rp 112k for tenants who
    // only want POS without the Komplit bundle.
    key: 'pos_toko_annual',
    moduleKey: 'pos',
    tier: 'toko',
    durationMonths: 12,
    pricePerMonth: 49000,
    additionalOutletPerMonth: 35000,
    salesPerDayCap: null,
    cashierCap: 3,
    branchCap: null,
    historyDays: null,
    paymentMethods: POS_ALL_PAYMENT_METHODS,
    features: POS_TOKO_FEATURES,
    labelKey: 'pricing.posTokoAnnual',
    // 38% off vs monthly. Strong annual incentive without the
    // 24-month lock Qasir requires for their headline rate.
    savingsLabel: '38%',
  },
  {
    // Komplit bundle monthly (JUR-5b). Bundles POS + Inventory +
    // Attendance (unlimited staff) + HPP. recordPOSPaymentAndActivate
    // flips on all 3 module subscriptions in one transaction.
    key: 'pos_komplit_monthly',
    moduleKey: 'pos',
    tier: 'komplit',
    durationMonths: 1,
    pricePerMonth: 75000,
    additionalOutletPerMonth: 60000,
    salesPerDayCap: null,
    // Komplit gets unlimited cashiers (matches Qasir's "no staff limit"
    // promise — even though attendance billing was per-staff, the
    // bundle subsumes that).
    cashierCap: null,
    branchCap: null,
    historyDays: null,
    paymentMethods: POS_ALL_PAYMENT_METHODS,
    features: POS_KOMPLIT_FEATURES,
    labelKey: 'pricing.posKomplitMonthly',
  },
  {
    // Komplit bundle annual — Rp 55k/month effective (Rp 660k/year).
    // Rp 40k cheaper than Qasir Pro Rp 700k for the same scope.
    // Marketing wedge: cheaper than Qasir AND no 24-month lock.
    key: 'pos_komplit_annual',
    moduleKey: 'pos',
    tier: 'komplit',
    durationMonths: 12,
    pricePerMonth: 55000,
    additionalOutletPerMonth: 45000,
    salesPerDayCap: null,
    cashierCap: null,
    branchCap: null,
    historyDays: null,
    paymentMethods: POS_ALL_PAYMENT_METHODS,
    features: POS_KOMPLIT_FEATURES,
    labelKey: 'pricing.posKomplitAnnual',
    savingsLabel: '27%',
    popular: true,
  },
  {
    key: 'pos_bisnis_monthly',
    moduleKey: 'pos',
    tier: 'bisnis',
    durationMonths: 1,
    pricePerMonth: 129000,
    additionalOutletPerMonth: 80000,
    salesPerDayCap: null,
    cashierCap: null,
    branchCap: null,
    historyDays: null,
    paymentMethods: POS_ALL_PAYMENT_METHODS,
    features: POS_BISNIS_FEATURES,
    labelKey: 'pricing.posBisnisMonthly',
    comingSoon: true,
  },
  {
    key: 'pos_bisnis_annual',
    moduleKey: 'pos',
    tier: 'bisnis',
    durationMonths: 12,
    pricePerMonth: 105000,
    additionalOutletPerMonth: 65000,
    salesPerDayCap: null,
    cashierCap: null,
    branchCap: null,
    historyDays: null,
    paymentMethods: POS_ALL_PAYMENT_METHODS,
    features: POS_BISNIS_FEATURES,
    labelKey: 'pricing.posBisnisAnnual',
    savingsLabel: '19%',
    comingSoon: true,
  },
  // Multi-outlet flat tier removed: per-outlet pricing on Toko/Bisnis
  // makes it redundant. Cross-outlet consolidated reports (the only
  // meaningful Multi-Outlet feature) move into Bisnis.
]

/** Default trial duration when admin starts a POS trial. */
export const POS_TRIAL_DEFAULTS = {
  durationDays: 7,
  /** Trial unlocks Toko-tier features. */
  tier: 'toko' as POSTierKey,
} as const

/** Trial pseudo-plan for ledger display. */
export const POS_TRIAL_PLAN: POSTier = {
  key: 'pos_trial',
  moduleKey: 'pos',
  tier: 'toko',
  durationMonths: 0,
  pricePerMonth: 0,
  additionalOutletPerMonth: 0,
  salesPerDayCap: null,
  cashierCap: 3,
  branchCap: null,
  historyDays: null,
  paymentMethods: POS_ALL_PAYMENT_METHODS,
  features: POS_TOKO_FEATURES,
  labelKey: 'pricing.posTrial',
}

export function findPOSPlan(planKey: string): POSTier | null {
  return POS_PLANS.find((p) => p.key === planKey) ?? null
}

export function findAnyPOSPlan(planKey: string): POSTier | null {
  if (planKey === POS_TRIAL_PLAN.key) return POS_TRIAL_PLAN
  return findPOSPlan(planKey)
}

/** Plan limits + features for a given resolved tier. */
export function posTierLimits(
  tier: POSTierKey,
): Pick<
  POSTier,
  'salesPerDayCap' | 'cashierCap' | 'branchCap' | 'historyDays' | 'paymentMethods' | 'features'
> {
  const plan =
    POS_PLANS.find((p) => p.tier === tier && !p.comingSoon) ??
    POS_PLANS.find((p) => p.tier === tier)
  if (!plan) {
    // Fall back to free safely.
    return {
      salesPerDayCap: 50,
      cashierCap: 1,
      branchCap: 1,
      historyDays: 30,
      paymentMethods: POS_FREE_PAYMENT_METHODS,
      features: [],
    }
  }
  return {
    salesPerDayCap: plan.salesPerDayCap,
    cashierCap: plan.cashierCap,
    branchCap: plan.branchCap,
    historyDays: plan.historyDays,
    paymentMethods: plan.paymentMethods,
    features: plan.features,
  }
}

/**
 * Total billing amount in IDR for a POS plan.
 *
 * Bill = base × months + extra-outlets × per-outlet × months
 * where extra = max(0, outletCount - 1). The first outlet is included
 * in the base price; only outlets BEYOND the first cost extra.
 *
 * `outletCount` defaults to 1 so old call sites keep working without
 * a code change — they'll bill the single-outlet rate (which is what
 * almost every tenant uses anyway).
 */
export function posTotal(planKey: string, outletCount: number = 1): number {
  const plan = findPOSPlan(planKey)
  if (!plan) throw new Error(`Unknown POS plan: ${planKey}`)
  const safeOutlets = Math.max(1, Math.floor(outletCount))
  const extra = safeOutlets - 1
  return (
    plan.pricePerMonth * plan.durationMonths +
    extra * plan.additionalOutletPerMonth * plan.durationMonths
  )
}

// ─── Cross-module branch cost breakdown ──────────────────────────────
//
// Drives /master/branches' cost preview and the admin drift indicator.
// Same math has to live in two places (server-side enforcement and the
// UI's live-update sheet), so we centralise it here.

/**
 * Inputs for a single tenant's branch billing snapshot.
 * `posTier` / `inventoryTier` come from `pos_settings.tier` and
 * `inventory_settings.tier` respectively; `branches` is the rendered
 * list with their `enabledModules` toggles. Komplit detection is
 * derived (`posTier === 'komplit'`) — no separate flag.
 */
export interface BranchCostInput {
  posTier: POSTierKey
  inventoryTier: InventoryTierKey
  /**
   * The exact plan key the tenant most recently paid for, used to pick
   * the correct `additionalOutletPerMonth` / `additionalLocationPerMonth`
   * (monthly vs annual variants of the same tier carry different
   * additional rates). When null, falls back to the first non-comingSoon
   * plan for the tier — fine for free-tier tenants who have no paid
   * subscription anyway.
   */
  posPlanKey?: string | null
  inventoryPlanKey?: string | null
  branches: ReadonlyArray<{ enabledModules: string[] }>
}

/**
 * Per-module monthly delta for the existing branch portfolio plus an
 * optional "if I added a branch with these toggles" preview. Numbers
 * are in IDR per month — multiply by subscription durationMonths for
 * the renewal-period total.
 *
 * Komplit's `additionalOutletPerMonth` only applies when the proposed
 * branch has ALL 3 modules on (full bundled outlet). Partial branches
 * (e.g. gudang = inventory only) fall through to the à la carte
 * Inventory / POS rates — which is the whole reason this helper
 * exists.
 */
export function branchCostBreakdown(input: BranchCostInput): {
  /** Current monthly extra billed because of branches beyond the first. */
  currentExtraPerMonth: number
  /** Per-module breakdown of the current extras. */
  breakdown: { pos: number; inventory: number; komplit: number }
}
export function branchCostBreakdown(
  input: BranchCostInput,
  proposed: { enabledModules: string[] },
): {
  currentExtraPerMonth: number
  /** Delta added by the proposed new branch on top of current state. */
  proposedDeltaPerMonth: number
  breakdown: { pos: number; inventory: number; komplit: number }
  proposedBreakdown: { pos: number; inventory: number; komplit: number }
}
export function branchCostBreakdown(
  input: BranchCostInput,
  proposed?: { enabledModules: string[] },
) {
  const isKomplit = input.posTier === 'komplit'

  // Count how many branches are "billable extras" per module — i.e.
  // branches beyond the first one with that module enabled.
  function extraCount(moduleKey: 'pos' | 'inventory'): number {
    const n = input.branches.filter((b) =>
      b.enabledModules.includes(moduleKey),
    ).length
    return Math.max(0, n - 1)
  }

  // Full-bundle extras = additional branches with ALL 3 modules on.
  // Only Komplit pays the bundled extra-outlet fee for these; otherwise
  // we fall back to per-module à la carte.
  const fullBundleExtra = Math.max(
    0,
    input.branches.filter(
      (b) =>
        b.enabledModules.includes('pos') &&
        b.enabledModules.includes('inventory') &&
        b.enabledModules.includes('attendance'),
    ).length - 1,
  )

  // Prefer the exact paid planKey when supplied — Komplit Annual
  // carries Rp 45k/extra-outlet while Komplit Monthly carries Rp 60k,
  // and picking the wrong variant misleads the cost preview by 33%.
  function priceFor(
    tier: 'pos' | 'inventory',
    tierKey: POSTierKey | InventoryTierKey,
  ): number {
    if (tier === 'pos') {
      const exact = input.posPlanKey
        ? POS_PLANS.find((p) => p.key === input.posPlanKey)
        : null
      const plan =
        exact ?? POS_PLANS.find((p) => p.tier === tierKey && !p.comingSoon)
      return plan?.additionalOutletPerMonth ?? 0
    }
    const exact = input.inventoryPlanKey
      ? INVENTORY_PLANS.find((p) => p.key === input.inventoryPlanKey)
      : null
    const plan =
      exact ??
      INVENTORY_PLANS.find((p) => p.tier === tierKey && !p.comingSoon)
    return plan?.additionalLocationPerMonth ?? 0
  }

  const komplitExtraPrice = isKomplit
    ? (input.posPlanKey
        ? POS_PLANS.find((p) => p.key === input.posPlanKey)
            ?.additionalOutletPerMonth
        : POS_PLANS.find((p) => p.tier === 'komplit' && !p.comingSoon)
            ?.additionalOutletPerMonth) ?? 0
    : 0

  // Komplit absorbs full-bundle extras into one line; non-bundle
  // extras still bill per module à la carte.
  let komplitExtras = 0
  let posExtras = 0
  let invExtras = 0
  if (isKomplit) {
    komplitExtras = fullBundleExtra * komplitExtraPrice
    // Partial branches (e.g. gudang-only) charge à la carte rates
    // even on Komplit.
    posExtras =
      (extraCount('pos') - fullBundleExtra) *
      priceFor('pos', input.posTier)
    invExtras =
      (extraCount('inventory') - fullBundleExtra) *
      priceFor('inventory', input.inventoryTier)
  } else {
    posExtras = extraCount('pos') * priceFor('pos', input.posTier)
    invExtras =
      extraCount('inventory') * priceFor('inventory', input.inventoryTier)
  }

  const breakdown = {
    pos: Math.max(0, posExtras),
    inventory: Math.max(0, invExtras),
    komplit: Math.max(0, komplitExtras),
  }
  const currentExtraPerMonth =
    breakdown.pos + breakdown.inventory + breakdown.komplit

  if (!proposed) {
    return { currentExtraPerMonth, breakdown }
  }

  // Re-run the math with the proposed branch appended. The recursive
  // call inherits the planKey hints so Komplit annual still resolves
  // to Rp 45k/extra-outlet on the delta, not the monthly Rp 60k.
  const proposedBranches = [...input.branches, proposed]
  const proposedResult = branchCostBreakdown({
    posTier: input.posTier,
    inventoryTier: input.inventoryTier,
    posPlanKey: input.posPlanKey,
    inventoryPlanKey: input.inventoryPlanKey,
    branches: proposedBranches,
  })

  return {
    currentExtraPerMonth,
    proposedDeltaPerMonth:
      proposedResult.currentExtraPerMonth - currentExtraPerMonth,
    breakdown,
    proposedBreakdown: proposedResult.breakdown,
  }
}

/**
 * Add N months to a date, preserving the day-of-month where possible.
 * Used to compute a subscription period end from its start.
 */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from)
  const targetMonth = d.getMonth() + months
  d.setMonth(targetMonth)
  // JS's setMonth rolls over (e.g., Jan 31 + 1 month = Mar 3 when Feb
  // has 28 days). Clamp back to last day of target month in that case.
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setDate(0)
  }
  return d
}

// ─── WhatsApp AI — annual billing (JUR: WA annual package) ───────────
//
// WA plans are billed monthly by default. Paying for a full year gets
// a flat discount; the admin payment sheet and the public pricing page
// both compute the annual price through `waAnnualPrice`.
export const WA_ANNUAL_DISCOUNT_PCT = 10

/** Annual WA price = 12 monthly payments minus the annual discount. */
export function waAnnualPrice(monthlyIdr: number): number {
  return Math.round(monthlyIdr * 12 * (1 - WA_ANNUAL_DISCOUNT_PCT / 100))
}
