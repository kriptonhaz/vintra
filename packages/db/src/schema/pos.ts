import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  jsonb,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { branches } from './attendance'
import { inventoryItems } from './inventory'
import { masterHppUnits } from './master-data'
import { tenantCategories } from './hpp'

/**
 * Configurable stale cash-session rule (#216). Decides when an open
 * session is flagged for force-close in the cashier <StaleSessionModal>.
 *  - `elapsed_hours`: stale after N hours open (pre-#216 behavior).
 *  - `daily_cutoff`: stale once the local clock crosses `cutoff` (HH:MM,
 *    evaluated in WIB) and the session opened before that boundary.
 *    `minHours` optionally suppresses the flag for sessions opened only
 *    a few hours before the cutoff (early-morning guard).
 *
 * Stored on `pos_settings` (tenant default) and `branches` (nullable
 * override). Timezone handling is fixed-WIB for now — see #217.
 */
export type CashStaleConfig =
  | { mode: 'elapsed_hours'; hours: number }
  | { mode: 'daily_cutoff'; cutoff: string; minHours?: number }

/**
 * Universal default: stale once the local clock passes 01:00 WIB and the
 * session opened before it (i.e. it carried into a new business day).
 * Suits the typical outlet that runs into the late evening far
 * better than a fixed elapsed-hours window, which tripped at closing
 * time. Set as the default for every tenant in migration 0125; a tenant
 * (or branch) can still switch to `elapsed_hours` in POS settings.
 */
export const DEFAULT_CASH_STALE_CONFIG: CashStaleConfig = {
  mode: 'daily_cutoff',
  cutoff: '01:00',
}

/**
 * Per-tenant POS subscription state. Mirrors inventory_settings:
 * paid + trial columns coexist orthogonally, the access middleware
 * grants tier features when EITHER is active (paid wins). `tier`
 * snapshots the feature set the tenant currently has — driven by
 * their last successful payment / trial start. Drops back to 'free'
 * when both expire.
 *
 * Adds POS-specific columns: receipt_logo_key, receipt_footer_text,
 * tax toggle + percent + label, allowed payment methods. These let
 * a Toko+ tenant customise checkout without per-page settings rows.
 */
export const posSettings = pgTable(
  'pos_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    /** 'free' | 'toko' | 'bisnis' | 'multi_outlet'. Constrained at DB level. */
    tier: text('tier').notNull().default('free'),
    subscriptionActive: boolean('subscription_active').notNull().default(false),
    subscriptionStartedAt: timestamp('subscription_started_at'),
    subscriptionExpiresAt: timestamp('subscription_expires_at'),
    trialStartedAt: timestamp('trial_started_at'),
    trialEndsAt: timestamp('trial_ends_at'),
    /** One-time gate: set true at first trial start, never reset programmatically. */
    trialUsed: boolean('trial_used').notNull().default(false),
    /** S3 key for the tenant's receipt logo (Toko+ feature). */
    receiptLogoKey: text('receipt_logo_key'),
    /** Custom receipt footer line (Toko+); free tenants get a default. */
    receiptFooterText: text('receipt_footer_text'),
    /**
     * @deprecated Replaced by the `taxes` JSONB array below in
     * migration 0029. Kept for one release as a fallback in case we
     * need to revert; live code reads exclusively from `taxes`.
     */
    taxEnabled: boolean('tax_enabled').notNull().default(false),
    /** @deprecated see `taxes`. */
    taxPercent: numeric('tax_percent', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    /** @deprecated see `taxes`. */
    taxLabel: text('tax_label').default('PPN'),
    /**
     * Per-tenant tax stack (multi-tax support, JUR follow-up). Array
     * of `{label: string, percent: number, active: boolean}`. Each
     * active row contributes one line to the cart breakdown + receipt
     * + per-sale `tax_lines` snapshot. Inactive rows stay configured
     * but don't apply — toggle without losing the value.
     *
     * Examples:
     *   [{label:'PPN', percent:11, active:true}]
     *   [{label:'PPN', percent:11, active:true},
     *    {label:'PB1', percent:10, active:true},
     *    {label:'Service', percent:5, active:false}]
     *
     * Each tax applies independently to the same post-discount,
     * post-promo, post-loyalty-redeem subtotal — no cumulative
     * stacking (PB1-on-top-of-service-charge model). Sum of every
     * active line's amount lands as `pos_sales.tax_amount` for the
     * snapshot a receipt + reports already use.
     */
    taxes: jsonb('taxes')
      .$type<
        Array<{
          label: string
          percent: number
          active: boolean
        }>
      >()
      .notNull()
      .default([]),
    /**
     * Allowed payment methods for this tenant. Cashier UI filters its
     * picker against this AND the tier's allowed list (intersection).
     * Free tenants can only set ['cash', 'qris']; Toko+ can pick any subset.
     */
    defaultPaymentMethods: text('default_payment_methods')
      .array()
      .notNull()
      .default(sql`ARRAY['cash', 'qris']::text[]`),
    /**
     * Bank accounts shown when the customer pays via Transfer Bank
     * (Toko+ feature, since `transfer` itself unlocks at Toko). Whole
     * array is replaced on each settings save — same edit model as
     * `taxes`. Inactive rows stay configured but aren't surfaced to
     * the cashier. Empty array = tenant hasn't added any yet.
     *
     * Example:
     *   [{bankName:'BCA', accountNumber:'1234567890',
     *     accountHolder:'PT Toko Maju Jaya', active:true}]
     */
    bankAccounts: jsonb('bank_accounts')
      .$type<
        Array<{
          bankName: string
          accountNumber: string
          accountHolder: string
          active: boolean
        }>
      >()
      .notNull()
      .default([]),
    /**
     * Loyalty config (Komplit-tier `loyalty_points` feature). Stored
     * even when disabled so the values stick across enable/disable
     * toggles.
     *
     * `earnRate` = points awarded per Rp spent (e.g. 0.001 → 1 pt per
     * Rp 1.000). Stored as numeric(15,4) so fractional rates like
     * 0.0005 are preservable.
     *
     * `redeemRate` = Rp value of one redeemed point (e.g. 10 → 1 pt
     * = Rp 10). Stored as numeric(15,2) since fractional Rupiah on
     * the redeem side would round oddly on receipts.
     */
    loyaltyEnabled: boolean('loyalty_enabled').notNull().default(false),
    /**
     * Earn-mode discriminator. 'linear' uses `loyaltyEarnRate` as a
     * per-Rp multiplier (legacy + default — every existing tenant
     * runs this). 'per_step' uses `loyaltyEarnStepAmount` +
     * `loyaltyEarnStepPoints` to model "earn N points for every full
     * Rp X spent" (jamu vendors / loyalty-card stamps / fixed-token
     * rewards). Switching modes is a hot-swap; no historical sales
     * are recomputed.
     */
    loyaltyEarnMode: text('loyalty_earn_mode').notNull().default('linear'),
    loyaltyEarnRate: numeric('loyalty_earn_rate', { precision: 15, scale: 4 })
      .notNull()
      .default('0.001'),
    /** per_step threshold: "every Rp X spent" — e.g. 15000. Ignored when mode='linear'. */
    loyaltyEarnStepAmount: numeric('loyalty_earn_step_amount', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /** per_step reward: points per full step — e.g. 750. Ignored when mode='linear'. */
    loyaltyEarnStepPoints: numeric('loyalty_earn_step_points', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    loyaltyRedeemRate: numeric('loyalty_redeem_rate', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('10'),
    /**
     * JUR-141 Peti Kas (Cash Drawer). When true the cashier MUST open
     * a session before ringing cash sales, and the createSale /
     * voidSale paths auto-insert ledger movements.
     *
     * PR 4 (migration 0056) flipped the default to true now that
     * the full feature has shipped. The application layer
     * additionally gates enforcement on `posTier === 'komplit'` so
     * free tenants never see the BukaKasModal even if a column
     * default somehow leaks true to them.
     */
    cashDrawerEnabled: boolean('cash_drawer_enabled')
      .notNull()
      .default(true),
    /**
     * Variance threshold for close-out highlight (`|variance| >= this`
     * renders red + asks for closing notes). Owner-tweakable per
     * tenant.
     */
    cashVarianceThreshold: numeric('cash_variance_threshold', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('10000'),
    /**
     * Stale-session rule (#216). Tenant default; a branch may override
     * via `branches.cash_stale_config` (NULL there = inherit this).
     * Drives the cashier <StaleSessionModal>. Defaults to a 01:00 WIB
     * daily cutoff (see DEFAULT_CASH_STALE_CONFIG) — the business-day
     * boundary that suits late-evening outlets.
     */
    cashStaleConfig: jsonb('cash_stale_config')
      .$type<CashStaleConfig>()
      .notNull()
      .default(DEFAULT_CASH_STALE_CONFIG),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tierChk: check(
      'pos_tier_chk',
      sql`${t.tier} IN ('free', 'toko', 'bisnis', 'multi_outlet', 'komplit')`,
    ),
    loyaltyEarnModeChk: check(
      'pos_loyalty_earn_mode_chk',
      sql`${t.loyaltyEarnMode} IN ('linear', 'per_step')`,
    ),
  }),
)

/**
 * Sale header. One row per completed transaction. Voids flip the
 * status field, never delete — preserves the audit trail and lets
 * the void path emit compensating inventory movements.
 *
 * `sale_number` is generated by the per-tenant counter on insert
 * (see posSaleCounters below); format is e.g. "JQU-2026-00001".
 */
export const posSales = pgTable(
  'pos_sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id)
      .notNull(),
    saleNumber: text('sale_number').notNull(),
    /** Supabase auth user ID who rang up the sale. */
    cashierUserId: uuid('cashier_user_id').notNull(),
    /**
     * Snapshot of customer name + phone at sale time. Kept alongside
     * `customerId` so receipts/exports stay self-contained even if a
     * customer row is later renamed or deleted. Required for ad-hoc
     * walk-ins (no `customerId` row).
     */
    customerName: text('customer_name'),
    /** WhatsApp share auto-populates from this; loose validation only. */
    customerPhone: text('customer_phone'),
    /**
     * FK to the customers table. Set when the cashier picked an
     * existing customer or auto-upsert created one from name+phone.
     * Null for true walk-ins (no phone provided).
     */
    customerId: uuid('customer_id'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull(),
    /** 'fixed' | 'percent' | NULL — null = no sale-level discount. */
    discountType: text('discount_type'),
    /** Configured discount value (Rp for fixed, 0–100 for percent). */
    discountValue: numeric('discount_value', { precision: 15, scale: 2 }),
    /** Computed Rp discount snapshot. */
    discountAmount: numeric('discount_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /** Computed tax SUM at sale time (sum of every tax_lines amount). */
    taxAmount: numeric('tax_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /**
     * Per-tax breakdown snapshot. Array of `{label, percent, amount}`
     * mirroring whichever tax rows were active at sale time. Receipts
     * + reports render each line; the singular `taxAmount` above stays
     * as the SUM for legacy callers. Nullable so pre-multi-tax sales
     * stay clean — those use `taxAmount` + the tenant's old single
     * label.
     */
    taxLines: jsonb('tax_lines').$type<
      Array<{ label: string; percent: number; amount: number }>
    >(),
    /** subtotal - discount_amount - loyalty_redeem_amount + tax_amount. */
    total: numeric('total', { precision: 15, scale: 2 }).notNull(),
    /**
     * Loyalty snapshot per sale (Komplit feature). All three are
     * nullable so older sales pre-loyalty stay clean. When loyalty is
     * configured + customer attached:
     *   - `loyaltyPointsEarned` is the points credited by this sale
     *   - `loyaltyPointsRedeemed` is the points the customer spent
     *   - `loyaltyRedeemAmount` is the IDR equivalent of redeemed points
     *     (= points × redeem_rate). Treated as a discount on the cart
     *     pre-tax, but distinct from `discount_amount` so reports can
     *     separate "marketing discount" from "loyalty redemption".
     */
    loyaltyPointsEarned: numeric('loyalty_points_earned', {
      precision: 15,
      scale: 2,
    }),
    loyaltyPointsRedeemed: numeric('loyalty_points_redeemed', {
      precision: 15,
      scale: 2,
    }),
    loyaltyRedeemAmount: numeric('loyalty_redeem_amount', {
      precision: 15,
      scale: 2,
    }),
    /**
     * Promo snapshot per JUR-9. Set for code-redeemed and auto_cart
     * trigger types; auto_product promos materialise per-line on
     * `pos_sale_items.auto_promo_*` instead. Stored alongside the
     * promo's discount amount so receipts/reports can render
     * "Promo HEMAT20 — Rp 20.000" without joining tenant_promotions.
     */
    promoCodeSnapshot: text('promo_code_snapshot'),
    promoAmount: numeric('promo_amount', { precision: 15, scale: 2 }),
    /** cash | qris | transfer | card | ewallet | gopay | shopeepay | ovo. */
    paymentMethod: text('payment_method').notNull(),
    paidAmount: numeric('paid_amount', { precision: 15, scale: 2 }).notNull(),
    /** Only meaningful for cash; computed = paid - total. */
    changeAmount: numeric('change_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /** 'completed' | 'voided'. */
    status: text('status').notNull().default('completed'),
    voidReason: text('void_reason'),
    /**
     * Optional structured void category — populated from a tenant-
     * configurable list (`pos_void_categories`). Letting cashiers pick
     * from a curated dropdown makes the reports breakdown ("most
     * cancellations were Ganti metode bayar") usable instead of the
     * free-text mush you get from `void_reason` alone. Nullable for
     * backfill compatibility — pre-existing voids bucket as "Tanpa
     * kategori" on the report.
     */
    voidCategoryId: uuid('void_category_id'),
    voidedAt: timestamp('voided_at'),
    voidedBy: uuid('voided_by'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqNumber: unique('pos_sales_tenant_number_unique').on(
      t.tenantId,
      t.saleNumber,
    ),
    statusChk: check(
      'pos_sales_status_chk',
      sql`${t.status} IN ('completed', 'voided')`,
    ),
    paymentChk: check(
      'pos_sales_payment_chk',
      sql`${t.paymentMethod} IN ('cash', 'qris', 'transfer', 'card', 'ewallet', 'gopay', 'shopeepay', 'ovo')`,
    ),
    discountChk: check(
      'pos_sales_discount_chk',
      sql`${t.discountType} IS NULL OR ${t.discountType} IN ('fixed', 'percent')`,
    ),
    branchDayIdx: index('pos_sales_branch_day_idx').on(t.branchId, t.createdAt),
    tenantDayIdx: index('pos_sales_tenant_day_idx').on(t.tenantId, t.createdAt),
  }),
)

/**
 * Tenant-configurable void categories. The void modal renders these
 * in a Select above the free-text Alasan field; the reports breakdown
 * groups voided sales by category so owners can see at-a-glance "most
 * voids were Ganti metode bayar".
 *
 * Five system-default rows are seeded lazily on first read for each
 * tenant (Ganti metode bayar, Salah input, Pelanggan batal, Item tidak
 * tersedia, Lainnya); the owner can add custom ones and archive
 * unwanted ones from /pos/settings.
 */
export const posVoidCategories = pgTable(
  'pos_void_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Seeded default — the UI prevents renaming/deleting so the
     *  semantics stay stable for tenants that don't customise. */
    isSystem: boolean('is_system').notNull().default(false),
    /** Archive instead of delete so historical voids keep their FK. */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('pos_void_categories_tenant_idx').on(t.tenantId),
  }),
)

/**
 * Sale lines. `item_id` is nullable for ad-hoc lines (services,
 * one-off items the cashier types in). When non-null, `createSale`
 * also writes an inventory_movements row (referenceType='pos_sale',
 * referenceId=sale_id) inside the same transaction so stock balances
 * stay consistent.
 *
 * Snapshots (name_snapshot, sku_snapshot, unit_price, hpp_at_sale)
 * preserve the sale's exact appearance and economics even if the
 * source item is later renamed, repriced, or deleted.
 */
export const posSaleItems = pgTable(
  'pos_sale_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    saleId: uuid('sale_id')
      .references(() => posSales.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for ad-hoc lines. When set, sale insert also creates an inventory_movements row. */
    itemId: uuid('item_id').references(() => inventoryItems.id),
    nameSnapshot: text('name_snapshot').notNull(),
    skuSnapshot: text('sku_snapshot'),
    /**
     * Quantity in the SOLD unit. E.g. selling sugar by kg → qty = 2 kg.
     * For inventory deduction the cashier writes qty_in_base separately
     * (= qty × ratio).
     */
    qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
    /**
     * Unit the customer was charged in (snapshot — see soldUnitLabel
     * for display). Null for ad-hoc lines.
     */
    soldUnitId: uuid('sold_unit_id').references(() => masterHppUnits.id),
    /** Snapshot of the unit's label at sale time, for receipts that don't join. */
    soldUnitLabel: text('sold_unit_label'),
    /**
     * qty translated to the inventory item's base unit. Used by the
     * stock-out movement so balances stay in their canonical unit.
     * Null for ad-hoc lines (no inventory link, no deduction).
     */
    qtyInBase: numeric('qty_in_base', { precision: 15, scale: 4 }),
    /** Selling price snapshot per SOLD unit (NOT per base unit). */
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
    /**
     * Per-line subtotal AFTER line-level discount, i.e.
     * `qty × unit_price - line_discount_amount`. Pre-JUR-7 rows had
     * line_discount_amount = 0 so the math is unchanged; post-JUR-7
     * the subtotal is the customer-facing amount the cashier saw on
     * that cart line. Receipt + reports read this column directly.
     */
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull(),
    /**
     * Line-level discount snapshot (JUR-7). Null = no per-line discount
     * applied; otherwise 'fixed' (Rp value) or 'percent' (0–100). Stored
     * separately from `discount_amount` on pos_sales so the P&L report
     * (JUR-11) can split line-level vs sale-level discounts.
     */
    lineDiscountType: text('line_discount_type'),
    /** Configured discount value (Rp for fixed, 0–100 for percent). */
    lineDiscountValue: numeric('line_discount_value', {
      precision: 15,
      scale: 2,
    }),
    /** Computed Rp discount amount for this line — already factored
     *  into `subtotal`. Materialised here so receipts can render
     *  "(diskon Rp X)" without re-deriving from value+type. */
    lineDiscountAmount: numeric('line_discount_amount', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /**
     * Auto-applied product-promo snapshot (JUR-9). Set when the cart
     * line matched a `trigger_type='auto_product'` promotion at sale
     * time. Distinct from `lineDiscount*` so reports can split
     * cashier-applied (manual) vs owner-configured (promo) discounts.
     * Both factor into the line's final `subtotal`.
     */
    autoPromoId: uuid('auto_promo_id'),
    autoPromoAmount: numeric('auto_promo_amount', {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /**
     * Whether this line hit a bulk-pricing tier (min_qty > 1). Receipt
     * rendering shows a "Harga Grosir" badge when true.
     */
    isBulkPrice: boolean('is_bulk_price').notNull().default(false),
    /**
     * HPP snapshot per unit at sale time. Sourced from the linked HPP
     * product's `hpp` (if set) or the inventory item's `cost_price`.
     * Forward-compat for the margin/profitability report (deferred).
     */
    hppAtSale: numeric('hpp_at_sale', { precision: 15, scale: 2 }),
    isAdhoc: boolean('is_adhoc').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    saleIdx: index('pos_sale_items_sale_idx').on(t.saleId),
    itemIdx: index('pos_sale_items_item_idx')
      .on(t.itemId)
      .where(sql`${t.itemId} IS NOT NULL`),
  }),
)

/**
 * Atomic per-tenant sale counter — same pattern as
 * `purchase_order_counters`. The `nextSaleNumber` helper does a
 * single upsert + return without locking the sales table.
 *
 * Format: `${prefix}-${year}-${seq.padStart(5,'0')}` where prefix
 * defaults to 'JQU'. Counter resets when year rolls over.
 */
export const posSaleCounters = pgTable('pos_sale_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nextSeq: integer('next_seq').notNull().default(1),
})

/**
 * Customer database (per-tenant). Promotes the per-sale name+phone
 * snapshot on pos_sales into a real entity so loyalty + promo codes
 * (W2-W3) can attach to a stable identity.
 *
 * Phone is normalised to "62..." form on insert/upsert. Unique within
 * a tenant via partial index `customers_tenant_phone_unique` (only
 * applies when phone IS NOT NULL — anonymous walk-ins don't collide).
 *
 * Aggregates (`totalSpent`, `visitCount`, `lastVisitAt`) are kept
 * up-to-date by `createSale` and reversed by `voidSale`. Cheaper than
 * computing on every read.
 */
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  /** Normalised "62..." form. Null for anonymous walk-ins. */
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  totalSpent: numeric('total_spent', { precision: 15, scale: 2 })
    .notNull()
    .default('0'),
  visitCount: integer('visit_count').notNull().default(0),
  lastVisitAt: timestamp('last_visit_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Per-customer loyalty balance (Komplit feature). One row per
 * customer, lazily inserted on first earn/redeem. Aggregates kept
 * here so the cashier picker can show balance with a single index
 * lookup instead of summing the movements ledger.
 *
 * `pointsBalance` = `lifetimeEarned` - `lifetimeRedeemed` (- expirations
 * if/when we add expiry — Phase 2). The split lets us show the
 * customer's "ever earned" total on their detail page.
 */
export const customerLoyaltyBalances = pgTable(
  'customer_loyalty_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    pointsBalance: numeric('points_balance', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    lifetimeEarned: numeric('lifetime_earned', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    lifetimeRedeemed: numeric('lifetime_redeemed', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    customerUnique: unique('customer_loyalty_balances_customer_unique').on(
      t.customerId,
    ),
  }),
)

/**
 * Loyalty ledger (one row per earn/redeem/adjust/expire). Source of
 * truth for the balance — we keep balances above for fast reads but
 * the ledger is what backs voids (reverse the movements written by
 * the original sale) and the customer detail-page history tab.
 *
 * `saleId` is set on earn + redeem (links to the originating sale);
 * null on `adjust` (admin override) and `expire` (scheduler tick).
 * `performedBy` is set on `adjust` only.
 */
export const customerLoyaltyMovements = pgTable(
  'customer_loyalty_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    /** 'earn' | 'redeem' | 'adjust' | 'expire' */
    type: text('type').notNull(),
    /**
     * Always positive in the ledger; the `type` decides direction.
     * Earn + adjust(positive) bump balance; redeem + expire +
     * adjust(negative-as-redeem) drop it. We store the absolute value
     * so reports can sum without sign juggling.
     */
    points: numeric('points', { precision: 15, scale: 2 }).notNull(),
    saleId: uuid('sale_id').references(() => posSales.id),
    reason: text('reason'),
    /** Supabase user id; only set on type='adjust'. */
    performedBy: uuid('performed_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    customerIdx: index('customer_loyalty_movements_customer_idx').on(
      t.customerId,
      t.createdAt,
    ),
    saleIdx: index('customer_loyalty_movements_sale_idx')
      .on(t.saleId)
      .where(sql`${t.saleId} IS NOT NULL`),
    typeChk: check(
      'customer_loyalty_movements_type_chk',
      sql`${t.type} IN ('earn', 'redeem', 'adjust', 'expire')`,
    ),
  }),
)

/**
 * JUR-9: Per-tenant promotions table covering all three trigger
 * modes:
 *
 *   - `code`: cashier types a code at checkout. Used with caps +
 *     min cart total + date window. Snapshots to
 *     `pos_sales.promo_code_snapshot`.
 *   - `auto_product`: applies automatically when a line for `productId`
 *     enters the cart. No code, no caps (auto-promos can't realistically
 *     rate-limit). Snapshots to `pos_sale_items.auto_promo_*`.
 *   - `auto_cart`: cart-wide auto-apply (e.g. happy hour). Same rules
 *     as `code` minus the code itself. Snapshots to `pos_sales`.
 *
 * The DB-level CHECK constraint ensures every row commits to exactly
 * one mode. Partial unique index on (tenant_id, code) enforces code
 * uniqueness only for code-mode rows.
 */
export const tenantPromotions = pgTable(
  'tenant_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Internal label, e.g. "Promo Lebaran 2026". Shown to owner; never to customer. */
    name: text('name').notNull(),
    /** The redemption code customers type. Null for auto-applied promos. */
    code: text('code'),
    /**
     * `code` | `auto_product` (legacy single-target — kept for back-compat) |
     * `auto_products` (multi-product) | `auto_category` | `auto_cart`. CHECK
     * at DB level. Items / categories targeted by auto_product(s) /
     * auto_category live in `promotion_targets`.
     */
    triggerType: text('trigger_type').notNull(),
    /** 'percent' | 'fixed'. */
    discountType: text('discount_type').notNull(),
    /** For percent: 0–100. For fixed: Rp value. */
    discountValue: numeric('discount_value', { precision: 15, scale: 2 }).notNull(),
    /** Cap for percent type, e.g. "20% off, max Rp 50.000". Null = uncapped. */
    maxDiscountAmount: numeric('max_discount_amount', { precision: 15, scale: 2 }),
    minCartTotal: numeric('min_cart_total', { precision: 15, scale: 2 }),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    /** Total redemptions across all customers; null = unlimited (codes only). */
    totalRedemptionCap: integer('total_redemption_cap'),
    /** Per-customer redemptions; null = unlimited (codes only). */
    perCustomerCap: integer('per_customer_cap'),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Optional promo flyer / banner. Stored under
     * `<tenantId>/promos/<promoId>.<ext>` with S3 tag `kind=promo` so
     * the wa-media 24h lifecycle doesn't sweep it. When the WhatsApp
     * AI's promo RAG fires AND the matched promo has an image, the
     * api side fetches the bytes and sends an image follow-up message
     * after the AI's text reply.
     */
    imageKey: text('image_key'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    // Target presence (must have at least one promotion_targets row for
    // auto_product / auto_products / auto_category) is enforced by the
    // application layer — it lives in a separate table.
    triggerChk: check(
      'tenant_promotions_trigger_chk',
      sql`(
        (${t.triggerType} = 'code'           AND ${t.code} IS NOT NULL) OR
        (${t.triggerType} = 'auto_product'   AND ${t.code} IS NULL) OR
        (${t.triggerType} = 'auto_products'  AND ${t.code} IS NULL) OR
        (${t.triggerType} = 'auto_category'  AND ${t.code} IS NULL) OR
        (${t.triggerType} = 'auto_cart'      AND ${t.code} IS NULL)
      )`,
    ),
    discountTypeChk: check(
      'tenant_promotions_discount_type_chk',
      sql`${t.discountType} IN ('percent', 'fixed')`,
    ),
  }),
)

/**
 * Items / categories an auto-promo applies to. Each row carries
 * exactly one of `itemId` or `categoryId` (XOR check). The cashier
 * builds two maps from this table (itemId → promo and categoryId →
 * promo) for O(1) per-line lookup; when more than one promo matches a
 * line, the highest computed discount wins. Cascades from the parent
 * promotion so a promo delete sweeps its targets.
 */
export const promotionTargets = pgTable(
  'promotion_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    promotionId: uuid('promotion_id')
      .references(() => tenantPromotions.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id').references(() => inventoryItems.id, {
      onDelete: 'cascade',
    }),
    categoryId: uuid('category_id').references(() => tenantCategories.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    xorChk: check(
      'promotion_targets_xor_chk',
      sql`(${t.itemId} IS NOT NULL) <> (${t.categoryId} IS NOT NULL)`,
    ),
    promoItemUniq: uniqueIndex('promotion_targets_promo_item_uniq')
      .on(t.promotionId, t.itemId)
      .where(sql`${t.itemId} IS NOT NULL`),
    promoCategoryUniq: uniqueIndex('promotion_targets_promo_category_uniq')
      .on(t.promotionId, t.categoryId)
      .where(sql`${t.categoryId} IS NOT NULL`),
    itemIdx: index('promotion_targets_item_idx')
      .on(t.itemId)
      .where(sql`${t.itemId} IS NOT NULL`),
    categoryIdx: index('promotion_targets_category_idx')
      .on(t.categoryId)
      .where(sql`${t.categoryId} IS NOT NULL`),
  }),
)

/**
 * Redemption ledger — one row per applied promo (code or auto). The
 * code-cap validation queries this table by promo_id (total cap) and
 * by (promo_id, customer_id) (per-customer cap). Auto promos also
 * write here for symmetric reporting; their amount is the per-line
 * lift for auto_product, or the cart-level lift for auto_cart.
 */
export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    promoId: uuid('promo_id')
      .references(() => tenantPromotions.id, { onDelete: 'cascade' })
      .notNull(),
    saleId: uuid('sale_id').references(() => posSales.id),
    customerId: uuid('customer_id'),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    promoIdx: index('promo_redemptions_promo_idx').on(t.promoId, t.createdAt),
    customerIdx: index('promo_redemptions_customer_idx')
      .on(t.customerId, t.promoId)
      .where(sql`${t.customerId} IS NOT NULL`),
  }),
)

/**
 * JUR-195: Stamp / punch-card programs ("cuci 5x gratis 1x").
 *
 * Distinct from the points system (customer_loyalty_*): a program
 * counts qualifying purchases — not Rupiah — and is SCOPED to one
 * product category, so a motor-wash card and a car-wash card
 * accumulate independently for the same customer.
 *
 * One active program per (tenant, category) — the partial unique
 * index lets an inactive (archived) program coexist with a fresh one.
 */
export const loyaltyStampPrograms = pgTable(
  'loyalty_stamp_programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    /**
     * Scope discriminator. Drives which column(s) the accrual logic
     * consults:
     *   'category'     → categoryId (any item in the category)
     *   'product'      → productId  (one specific item)
     *   'product_set'  → loyaltyStampProgramItems join rows (any of N)
     *
     * The mutex is enforced in application code rather than via CHECK
     * because 'product_set' depends on row counts in another table.
     */
    scope: text('scope').notNull().default('category'),
    categoryId: uuid('category_id').references(() => tenantCategories.id, {
      onDelete: 'cascade',
    }),
    productId: uuid('product_id').references(() => inventoryItems.id, {
      onDelete: 'cascade',
    }),
    /** Stamps needed to earn one reward (e.g. 5 → "cuci 5x"). */
    stampsRequired: integer('stamps_required').notNull(),
    /**
     * Reward mode discriminator:
     *   'single' → rewardItemId is the single free item (qty 1)
     *   'bundle' → loyaltyStampProgramRewards rows define N items × qty
     */
    rewardMode: text('reward_mode').notNull().default('single'),
    /** Single-reward item. Nullable when rewardMode = 'bundle'. */
    rewardItemId: uuid('reward_item_id').references(() => inventoryItems.id),
    /**
     * Optional banner image for the program. Stored under
     * `<tenantId>/stamps/<programId>.<ext>` with S3 tag `kind=stamp`
     * so the wa-media 24h lifecycle doesn't sweep it. Used in the
     * admin program list, cashier strip, and the situs Stamp section.
     */
    imageKey: text('image_key'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('loyalty_stamp_programs_tenant_idx').on(t.tenantId),
    // One active program per (tenant, category) — category scope only.
    activeCategoryUnique: uniqueIndex(
      'loyalty_stamp_programs_active_category_unique',
    )
      .on(t.tenantId, t.categoryId)
      .where(sql`${t.isActive} AND ${t.categoryId} IS NOT NULL`),
    // Same rule for single-product scope.
    activeProductUnique: uniqueIndex(
      'loyalty_stamp_programs_active_product_unique',
    )
      .on(t.tenantId, t.productId)
      .where(sql`${t.isActive} AND ${t.productId} IS NOT NULL`),
    stampsPositiveChk: check(
      'loyalty_stamp_programs_stamps_positive_chk',
      sql`${t.stampsRequired} > 0`,
    ),
    scopeKindChk: check(
      'loyalty_stamp_programs_scope_kind_chk',
      sql`${t.scope} IN ('category', 'product', 'product_set')`,
    ),
    rewardModeChk: check(
      'loyalty_stamp_programs_reward_mode_chk',
      sql`${t.rewardMode} IN ('single', 'bundle')`,
    ),
  }),
)

/**
 * Items that qualify the program when scope = 'product_set'. One row
 * per item; every line of any of these items advances the card. Empty
 * for category / single-product scope.
 */
export const loyaltyStampProgramItems = pgTable(
  'loyalty_stamp_program_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    programId: uuid('program_id')
      .references(() => loyaltyStampPrograms.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    programIdx: index('loyalty_stamp_program_items_program_idx').on(t.programId),
    itemIdx: index('loyalty_stamp_program_items_item_idx').on(t.itemId),
    programItemUnique: unique(
      'loyalty_stamp_program_items_program_item_unique',
    ).on(t.programId, t.itemId),
  }),
)

/**
 * Items granted on redemption when rewardMode = 'bundle'. e.g.
 * "1 teh original + 1 candy" → two rows, each with quantity 1.
 * sortOrder controls display order on the receipt + cashier UI.
 */
export const loyaltyStampProgramRewards = pgTable(
  'loyalty_stamp_program_rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    programId: uuid('program_id')
      .references(() => loyaltyStampPrograms.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: integer('quantity').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    programIdx: index('loyalty_stamp_program_rewards_program_idx').on(
      t.programId,
    ),
    quantityPositiveChk: check(
      'loyalty_stamp_program_rewards_quantity_positive_chk',
      sql`${t.quantity} > 0`,
    ),
  }),
)

/**
 * Per-customer progress on one stamp program. One row per
 * (customer, program), lazily inserted on the first qualifying
 * purchase. `currentStamps` is the live card; lifetime columns are
 * append-only totals for the customer detail page.
 */
export const customerStampCards = pgTable(
  'customer_stamp_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    customerId: uuid('customer_id')
      .references(() => customers.id, { onDelete: 'cascade' })
      .notNull(),
    programId: uuid('program_id')
      .references(() => loyaltyStampPrograms.id, { onDelete: 'cascade' })
      .notNull(),
    currentStamps: integer('current_stamps').notNull().default(0),
    lifetimeStamps: integer('lifetime_stamps').notNull().default(0),
    lifetimeRewards: integer('lifetime_rewards').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    cardUnique: unique('customer_stamp_cards_customer_program_unique').on(
      t.customerId,
      t.programId,
    ),
  }),
)

/**
 * Stamp ledger — one row per earn / redeem / adjust event.
 * `stamps` is always positive; `type` decides direction.
 * `saleId` is set on earn + redeem, null on `adjust`.
 * `performedBy` is set on `adjust` only.
 */
export const customerStampMovements = pgTable(
  'customer_stamp_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    cardId: uuid('card_id')
      .references(() => customerStampCards.id, { onDelete: 'cascade' })
      .notNull(),
    /** 'earn' | 'redeem' | 'adjust' */
    type: text('type').notNull(),
    stamps: integer('stamps').notNull(),
    saleId: uuid('sale_id').references(() => posSales.id),
    reason: text('reason'),
    /** Supabase user id; only set on type='adjust'. */
    performedBy: uuid('performed_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    cardIdx: index('customer_stamp_movements_card_idx').on(
      t.cardId,
      t.createdAt,
    ),
    typeChk: check(
      'customer_stamp_movements_type_chk',
      sql`${t.type} IN ('earn', 'redeem', 'adjust')`,
    ),
  }),
)
