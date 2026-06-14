/**
 * Toko Online (storefront) — public e-commerce layered on top of the
 * tenant's Situs (tenant_sites). Komplit-tier, gated behind the same
 * `tenant_site` feature as the site builder plus a per-tenant enable
 * toggle on `storefront_settings`.
 *
 * Design notes:
 *   - Payment methods are NOT duplicated here. `storefront_settings`
 *     stores only the SUBSET of `pos_settings.default_payment_methods`
 *     the tenant chose to surface online; bank accounts / QRIS config
 *     stays the single source of truth on `pos_settings`.
 *   - Online orders are a SEPARATE model from `pos_sales`: they have a
 *     real lifecycle (pending → confirmed → shipped → completed) and
 *     manual payment reconciliation, which pos_sales (completed|voided,
 *     instant settlement) can't represent.
 *   - Stock is deducted on admin CONFIRMATION, not at checkout — see
 *     the `confirmOnlineOrder` server fn. The catalog does a soft stock
 *     check at checkout only.
 */
import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { branches } from './attendance'
import { customers, tenantPromotions } from './pos'
import { inventoryItems } from './inventory'
import { waInstances } from './whatsapp'

/**
 * Per-tenant storefront config. One row per tenant (lazily created on
 * first settings save). Holds the online-store toggle, fulfillment
 * branch, the payment-method subset to display, and manual shipping
 * config (per-zone rates live in `storefront_shipping_zones`; this row
 * holds the flat fallback).
 */
export const storefrontSettings = pgTable('storefront_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  /** Master switch — when false the public storefront pages 404 / hide cart. */
  isEnabled: boolean('is_enabled').notNull().default(false),
  /**
   * Branch whose `inventory_stock_balances` fulfils online orders and
   * is deducted on confirmation. Null = lazily resolve the tenant's
   * main/oldest branch at order time.
   */
  fulfillmentBranchId: uuid('fulfillment_branch_id').references(
    () => branches.id,
    { onDelete: 'set null' },
  ),
  /**
   * Subset of `pos_settings.default_payment_methods` to show at online
   * checkout. The cashier picker stays the source of truth; this just
   * filters which of those appear on the storefront.
   */
  paymentMethods: text('payment_methods')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  /** Whether delivery (address + ongkir) is offered. */
  deliveryEnabled: boolean('delivery_enabled').notNull().default(true),
  /** Whether in-store pickup (no ongkir) is offered. */
  pickupEnabled: boolean('pickup_enabled').notNull().default(true),
  /** Flat ongkir used when no zone is selected / single-rate stores. */
  flatShippingFee: numeric('flat_shipping_fee', { precision: 15, scale: 2 })
    .notNull()
    .default('0'),
  /**
   * Phone (normalised "62…") the customer's "Konfirmasi via WhatsApp"
   * deep link (wa.me) targets. Falls back to the fulfillment branch
   * phone when null. This is the no-integration path that works for
   * every tenant.
   */
  waConfirmPhone: text('wa_confirm_phone'),
  /**
   * Optional connected WhatsApp instance used to AUTO-notify the admin
   * of a new order (the integrated path). Null = deep-link only.
   * `wa_instances.admin_phone` is the notification recipient.
   */
  adminNotifyInstanceId: uuid('admin_notify_instance_id').references(
    () => waInstances.id,
    { onDelete: 'set null' },
  ),
  /** Mirror `pos_settings.taxes` onto online orders when true. */
  applyTax: boolean('apply_tax').notNull().default(true),
  /** Free-form note shown on the checkout + confirmation page. */
  checkoutNote: text('checkout_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Manual shipping zones (e.g. "Dalam kota", "Luar kota"). Each is a
 * flat fee the customer picks at checkout. Edited as add/remove rows
 * like the tax stack. The flat fallback lives on storefront_settings.
 */
export const storefrontShippingZones = pgTable(
  'storefront_shipping_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    fee: numeric('fee', { precision: 15, scale: 2 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('storefront_shipping_zones_tenant_idx').on(
      t.tenantId,
      t.isActive,
    ),
  }),
)

/**
 * Atomic per-tenant order counter — same pattern as
 * `pos_sale_counters`. Format: `ORD-${year}-${seq.padStart(5,'0')}`.
 */
export const onlineOrderCounters = pgTable('online_order_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nextSeq: integer('next_seq').notNull().default(1),
})

/**
 * Online order header. Created in `pending` at checkout; the admin
 * confirms payment (→ `confirmed`, stock deducted), ships (→ `shipped`
 * with courier + resi) or marks `ready` for pickup, then `completed`.
 * `cancelled` restocks if it was already confirmed.
 */
export const onlineOrders = pgTable(
  'online_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Fulfillment branch — whose stock is deducted on confirmation. */
    branchId: uuid('branch_id')
      .references(() => branches.id)
      .notNull(),
    /** `ORD-YYYY-00001`, unique per tenant. */
    orderNumber: text('order_number').notNull(),
    /** Upserted by normalised phone for CRM; null if upsert skipped. */
    customerId: uuid('customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    customerName: text('customer_name').notNull(),
    /** Normalised "62…" form — also the tracking-lookup key. */
    customerPhone: text('customer_phone').notNull(),

    /** 'delivery' | 'pickup'. */
    fulfillmentType: text('fulfillment_type').notNull(),
    /** Shipping snapshot — null for pickup. */
    shippingRecipient: text('shipping_recipient'),
    shippingPhone: text('shipping_phone'),
    shippingAddress: text('shipping_address'),
    shippingZoneId: uuid('shipping_zone_id').references(
      () => storefrontShippingZones.id,
      { onDelete: 'set null' },
    ),
    /** Zone label snapshot (zone row may be renamed/deleted later). */
    shippingZoneLabel: text('shipping_zone_label'),
    shippingFee: numeric('shipping_fee', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),

    /** Sum of line subtotals, pre-promo pre-tax pre-ongkir. */
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull(),
    promoCodeSnapshot: text('promo_code_snapshot'),
    promoAmount: numeric('promo_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    taxAmount: numeric('tax_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /** Per-tax breakdown snapshot: [{label, percent, amount}]. */
    taxLines: jsonb('tax_lines').$type<
      Array<{ label: string; percent: number; amount: number }>
    >(),
    /** subtotal - promo + tax + shippingFee. */
    total: numeric('total', { precision: 15, scale: 2 }).notNull(),

    /** Chosen method (must be in storefront_settings.payment_methods). */
    paymentMethod: text('payment_method').notNull(),
    /** S3 key of the optional uploaded transfer proof. */
    paymentProofKey: text('payment_proof_key'),

    /** pending | confirmed | ready | shipped | completed | cancelled. */
    status: text('status').notNull().default('pending'),
    courierName: text('courier_name'),
    trackingNumber: text('tracking_number'),

    /** Loyalty points granted on confirmation (Komplit, if enabled). */
    loyaltyPointsEarned: numeric('loyalty_points_earned', {
      precision: 15,
      scale: 2,
    }),

    customerNote: text('customer_note'),
    adminNote: text('admin_note'),

    confirmedAt: timestamp('confirmed_at'),
    confirmedBy: uuid('confirmed_by'),
    shippedAt: timestamp('shipped_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelledBy: uuid('cancelled_by'),
    cancelReason: text('cancel_reason'),
    /** When the admin WA notification was dispatched (integrated path). */
    waNotifiedAt: timestamp('wa_notified_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    orderNumberUnique: unique('online_orders_tenant_order_number_unique').on(
      t.tenantId,
      t.orderNumber,
    ),
    tenantStatusIdx: index('online_orders_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    /** Tracking lookup: order number + phone. */
    phoneIdx: index('online_orders_tenant_phone_idx').on(
      t.tenantId,
      t.customerPhone,
    ),
    statusChk: check(
      'online_orders_status_chk',
      sql`${t.status} IN ('pending', 'confirmed', 'ready', 'shipped', 'completed', 'cancelled')`,
    ),
    fulfillmentChk: check(
      'online_orders_fulfillment_chk',
      sql`${t.fulfillmentType} IN ('delivery', 'pickup')`,
    ),
  }),
)

/**
 * Online order line items — mirrors `pos_sale_items` (name/sku/price
 * snapshots so historical orders are stable when the catalog changes).
 */
export const onlineOrderItems = pgTable(
  'online_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: uuid('order_id')
      .references(() => onlineOrders.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null if the item was later deleted from the catalog. */
    itemId: uuid('item_id').references(() => inventoryItems.id, {
      onDelete: 'set null',
    }),
    /**
     * Chosen variant (Phase 2), when the item has variants. FK column
     * only — defined without a Drizzle reference to avoid a cross-file
     * cycle; the constraint is added in the migration.
     */
    variantId: uuid('variant_id'),
    /** Variant label snapshot, e.g. "M / Merah". Null for plain items. */
    variantLabel: text('variant_label'),
    nameSnapshot: text('name_snapshot').notNull(),
    skuSnapshot: text('sku_snapshot'),
    qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
    /** qty × unitPrice − autoPromoAmount. */
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull(),
    /** Per-unit shipping weight snapshot (grams) for reference. */
    weightGramsSnapshot: integer('weight_grams_snapshot'),
    autoPromoId: uuid('auto_promo_id').references(() => tenantPromotions.id, {
      onDelete: 'set null',
    }),
    autoPromoAmount: numeric('auto_promo_amount', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /** Cost snapshot for margin reports. */
    hppAtSale: numeric('hpp_at_sale', { precision: 15, scale: 2 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    orderIdx: index('online_order_items_order_idx').on(t.orderId),
  }),
)
