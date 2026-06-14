import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  unique,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { branches } from './attendance'
import { tenantCategories, suppliers, materials, products } from './hpp'
import { masterHppUnits } from './master-data'

/**
 * Per-tenant inventory subscription state. Mirrors attendance_settings:
 * paid + trial columns coexist orthogonally; the access middleware grants
 * tier features when EITHER is active (paid wins). `tier` snapshots the
 * feature set the tenant currently has — driven by their last successful
 * payment / trial start. Drops back to 'free' when both expire.
 */
export const inventorySettings = pgTable(
  'inventory_settings',
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
    lowStockAlertsEnabled: boolean('low_stock_alerts_enabled')
      .notNull()
      .default(true),
    /**
     * Free tier locks inventory to a single user-chosen branch (the
     * "cabang utama"). Paid tiers ignore this column — they're
     * unlimited across all tenant branches. Nullable so onboarding
     * can lazily auto-pick the oldest branch on first inventory access
     * rather than requiring a forced setup step.
     */
    mainBranchId: uuid('main_branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tierChk: check(
      'inventory_tier_chk',
      sql`${t.tier} IN ('free', 'toko', 'bisnis', 'multi_outlet')`,
    ),
  }),
)

/**
 * Inventory items (the "thing you track stock of"). Independent from
 * HPP `products` / `materials` but can optionally LINK to either via
 * nullable FKs — the recordMovement helper writes back to HPP when
 * a link exists (so HPP costs stay fresh when the user records a
 * stock-in here).
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    /**
     * Manufacturer / brand label. Mirrors the equivalent column on
     * `materials` so HPP-linked items can fall back to (or override
     * with) the master brand. Nullable: smaller merchants often won't bother.
     */
    brand: text('brand'),
    categoryId: uuid('category_id').references(() => tenantCategories.id, {
      onDelete: 'set null',
    }),
    baseUnitId: uuid('base_unit_id')
      .references(() => masterHppUnits.id)
      .notNull(),
    costPrice: numeric('cost_price', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    /**
     * Price HQ charges a franchise branch for this item via the
     * inter-branch requisition. NULL = not offered to franchises (the
     * item can't appear on a franchise stock order). Distinct from
     * `costPrice` (HPP) and from any POS selling price.
     */
    franchisePrice: numeric('franchise_price', { precision: 15, scale: 2 }),
    /**
     * @deprecated Selling prices are now per-(unit, qty) tier. See
     * `inventoryItemUnitPricing` below. The column was dropped in
     * migration 0019. Field removed from this schema; the cashier
     * queries the new pricing table.
     */
    minStockLevel: numeric('min_stock_level', { precision: 15, scale: 4 }),
    photoKey: text('photo_key'),
    notes: text('notes'),
    /** Optional link to HPP catalog. Either side may be null. */
    linkedHppMaterialId: uuid('linked_hpp_material_id').references(
      () => materials.id,
      { onDelete: 'set null' },
    ),
    /**
     * Per-item override for HPP price sync. When true (default for new
     * items) AND the item links to an HPP material:
     *  - stock-in movements push their unit cost to materials.pricePerUnit
     *  - HPP material price edits trigger a "Apply to inventory?"
     *    notification with bulk-update affordance
     * Off lets a power user keep the link visible for traceability but
     * stop the auto-sync (e.g., they buy at a different price than HPP
     * stores for costing reasons). Ignored when linkedHppMaterialId is
     * null — no link, nothing to sync.
     */
    autoSyncHppCost: boolean('auto_sync_hpp_cost').notNull().default(true),
    linkedHppProductId: uuid('linked_hpp_product_id').references(
      () => products.id,
      { onDelete: 'set null' },
    ),
    /**
     * Whether this item appears in the POS catalog. Smart default at
     * create time:
     *   linkedHppMaterialId set (raw ingredient) → false
     *   everything else → true
     * Admin can override per-item from the inventory edit form.
     * `listPOSProducts` filters on this so ingredient inventory items
     * don't leak into the cashier grid.
     */
    isSellable: boolean('is_sellable').notNull().default(true),
    /**
     * JUR-182: surfaces this item in the booking service picker when
     * also `is_sellable=true`. Default false so existing inventory
     * doesn't pollute the booking flow for tenants who haven't opted
     * in. Tenants flip per-item from /inventory/items (JUR-183).
     */
    isBookable: boolean('is_bookable').notNull().default(false),
    /**
     * JUR-182: optional hex color for the booking calendar bubble.
     * Mirrors the dropped `booking_services.color`. Calendar falls back
     * to a stable grey when null.
     */
    bookingColor: text('booking_color'),
    /**
     * JUR-182: how many minutes this service takes when booked. Nullable
     * — when null, the calendar falls back to `booking_settings.slot_duration_min`
     * for the tenant. Stocked goods sold via POS don't set this.
     */
    bookingDurationMin: integer('booking_duration_min'),
    /**
     * Batch-prep mode (JUR-15). When true on a recipe-backed item
     * (linkedHppProductId set), the POS sale path stops auto-deducting
     * BOM ingredients per sale; instead the owner runs a "Prep batch"
     * action that deducts ingredients in bulk and increments a counter
     * in `inventory_item_prep_batches`. Each sale then FIFO-consumes
     * that counter. Off (default) keeps the existing per-sale BOM
     * deduction. Meaningless unless linkedHppProductId is set — DB
     * CHECK constraint enforces.
     */
    prepMode: boolean('prep_mode').notNull().default(false),
    /**
     * Pin to the top of the POS cashier grid when the "Semua" (all
     * categories) filter is active. Lets owners surface best-sellers
     * / staple items so cashiers don't scroll to find them. Has no
     * effect inside a specific category view (alphabetical is what
     * the cashier expects there). Owner toggles per-item from the
     * /inventory/items/<id> detail page.
     */
    isFavorite: boolean('is_favorite').notNull().default(false),
    /**
     * Toko Online curation: when true the item appears in the public
     * storefront catalog and is buyable online. Independent from
     * `isSellable` (POS grid) so tenants curate the online catalog
     * separately. Default false — opt-in per item.
     */
    isOnline: boolean('is_online').notNull().default(false),
    /**
     * Per-unit shipping weight in grams, used for reference and any
     * future weight-based ongkir. Nullable — optional for the manual
     * per-zone shipping model.
     */
    shippingWeightGrams: integer('shipping_weight_grams'),
    /**
     * Optional cap on how much of the physical stock is exposed online
     * (e.g. reserve some for in-store sales). Null = use full branch
     * balance. In the item's base unit.
     */
    onlineStockCap: numeric('online_stock_cap', { precision: 15, scale: 4 }),
    /**
     * Product variants (e.g. Ukuran × Warna). When true, the item is
     * sold as one of its `inventory_item_variants` rows — each combo has
     * its own price + per-branch stock. The item's own base price/stock
     * become fallbacks. Surfaced online first; POS variant-selling is a
     * later phase.
     */
    hasVariants: boolean('has_variants').notNull().default(false),
    /**
     * Variant dimension setup (1–2 dims), e.g.
     *   { dims: [ {name:'Ukuran', values:['S','M','L']},
     *             {name:'Warna',  values:['Merah','Biru']} ] }
     * Names + values are seller-defined free text. The combinations are
     * materialised as `inventory_item_variants` rows. Null when
     * hasVariants is false.
     */
    variantConfig: jsonb('variant_config').$type<{
      dims: Array<{ name: string; values: string[] }>
    } | null>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantActiveIdx: index('inventory_items_tenant_active_idx').on(
      t.tenantId,
      t.isActive,
    ),
    /** SKU is unique per tenant when set. Null SKUs (auto-generated or absent) don't conflict. */
    tenantSkuIdx: uniqueIndex('inventory_items_tenant_sku_idx')
      .on(t.tenantId, t.sku)
      .where(sql`${t.sku} IS NOT NULL`),
    prepModeRecipeChk: check(
      'inventory_items_prep_mode_requires_recipe_chk',
      sql`${t.prepMode} = false OR ${t.linkedHppProductId} IS NOT NULL`,
    ),
  }),
)

/**
 * Per-(item, branch) running balance. Updated atomically by the
 * recordMovement server function inside a single transaction with
 * the movement insert. The `quantity` column is always in the item's
 * BASE unit — alternate-unit movements are converted at insert time.
 */
export const inventoryStockBalances = pgTable(
  'inventory_stock_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: numeric('quantity', { precision: 15, scale: 4 })
      .notNull()
      .default('0'),
    lastMovementAt: timestamp('last_movement_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('inventory_stock_balances_item_branch_unique').on(
      t.itemId,
      t.branchId,
    ),
  }),
)

/**
 * Append-only ledger of prep batches for recipe-backed POS items
 * (JUR-15). Each row records ONE prep action: the owner pressed
 * "Prep batch" for X cups of Teh, the BOM was deducted from inventory,
 * and `qtyPrepared = X` was inserted here. Subsequent prep-mode sales
 * FIFO-decrement `qtyConsumed` against the oldest open rows (open =
 * qtyConsumed < qtyPrepared).
 *
 * "Siap" (current available count for cashier UI) =
 *   SUM(qtyPrepared - qtyConsumed) WHERE item + branch matches AND
 *   qtyConsumed < qtyPrepared. We don't sum across closed rows so the
 *   query plan stays small as history grows.
 *
 * `qtyPrepared` is in the item's BASE unit so it matches the cashier
 * sale quantities (which always convert to base before persisting).
 * Display in the item's default unit is computed at the UI layer the
 * same way stock balances are.
 */
export const inventoryItemPrepBatches = pgTable(
  'inventory_item_prep_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    qtyPrepared: numeric('qty_prepared', { precision: 15, scale: 4 }).notNull(),
    qtyConsumed: numeric('qty_consumed', { precision: 15, scale: 4 })
      .notNull()
      .default('0'),
    /** Supabase auth user ID who triggered the prep. */
    preparedBy: uuid('prepared_by').notNull(),
    preparedAt: timestamp('prepared_at').defaultNow().notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    /**
     * FIFO consume scans (item, branch) rows in ascending preparedAt.
     * The partial index on open rows keeps the working set small —
     * closed (fully consumed) rows never appear in the scan plan, so
     * a tenant who's been running for a year doesn't pay history cost.
     */
    openByItemBranchIdx: index('inv_prep_batches_open_item_branch_idx')
      .on(t.itemId, t.branchId, t.preparedAt)
      .where(sql`${t.qtyConsumed} < ${t.qtyPrepared}`),
    /** Waste-report aggregation — group by item + day. */
    tenantPreparedAtIdx: index('inv_prep_batches_tenant_prepared_at_idx').on(
      t.tenantId,
      t.preparedAt,
    ),
    consumedNotOverChk: check(
      'inv_prep_batches_consumed_not_over_chk',
      sql`${t.qtyConsumed} <= ${t.qtyPrepared}`,
    ),
    preparedPositiveChk: check(
      'inv_prep_batches_prepared_positive_chk',
      sql`${t.qtyPrepared} > 0`,
    ),
  }),
)

/**
 * Append-only ledger of every stock change. `quantity` is always
 * positive — direction comes from `movementType` ('in' adds, 'out' /
 * 'transfer_out' subtract, 'adjustment' is signed via a separate field
 * if needed but for MVP we treat it as the new absolute or delta
 * depending on UI choice). transfer_in/out are reserved for Phase 3.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * Set when the movement targets a specific variant's stock (e.g. an
     * online sale of "M / Merah"). Null for plain item-level movements.
     * Defined as a column ref to avoid a forward-decl cycle — the FK is
     * added in the migration.
     */
    variantId: uuid('variant_id'),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    /** 'in' | 'out' | 'adjustment' | 'transfer_in' | 'transfer_out'. */
    movementType: text('movement_type').notNull(),
    /** Always in the item's base unit; positive. */
    quantity: numeric('quantity', { precision: 15, scale: 4 }).notNull(),
    /** Cost-per-base-unit at this movement. Null for outbound when not tracked. */
    unitCost: numeric('unit_cost', { precision: 15, scale: 2 }),
    /** Free-text reason chip: 'sale' | 'damaged' | 'expired' | 'opname' | 'pembelian' | etc. */
    reason: text('reason'),
    /** 'manual' | 'purchase_order' | 'pos_sale' (future) | 'transfer'. */
    referenceType: text('reference_type'),
    /** FK target depends on referenceType — kept generic to avoid schema churn. */
    referenceId: uuid('reference_id'),
    notes: text('notes'),
    /** Supabase auth user ID who recorded the movement. */
    performedBy: uuid('performed_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    typeChk: check(
      'inventory_movements_type_chk',
      sql`${t.movementType} IN ('in', 'out', 'adjustment', 'transfer_in', 'transfer_out')`,
    ),
    itemIdx: index('inventory_movements_item_idx').on(t.itemId, t.createdAt),
    tenantCreatedIdx: index('inventory_movements_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
)

/**
 * Per-item, per-unit setup. Replaces the old `inventory_unit_conversions`
 * table. Holds BOTH the base unit (ratio_to_base = 1) AND every alt
 * unit the user has configured, so the cashier can query a single
 * source of truth for "what units can I sell this in".
 *
 * Ratio meaning: how many BASE units does 1 of THIS unit equal?
 * E.g. for sugar with base = gram, a kg row has ratio_to_base = 1000
 * (1 kg = 1000 grams). The recordMovement helper multiplies user-entered
 * qty by ratio to convert into the base before persisting.
 */
export const inventoryItemUnits = pgTable(
  'inventory_item_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: uuid('unit_id')
      .references(() => masterHppUnits.id)
      .notNull(),
    /** 1 for the base unit; >1 for "this unit packs more base units in" (e.g. kg = 1000g). */
    ratioToBase: numeric('ratio_to_base', { precision: 15, scale: 4 })
      .notNull()
      .default('1'),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * "Default sale unit" — the cashier card displays price + stock in
     * THIS unit when set. Exactly one row per item is true (enforced
     * by partial unique index `inventory_item_units_one_default_per_item`).
     * Backfilled to the base unit on the 0020 migration; admin can flip
     * via "Jadikan Default" in the item detail editor.
     */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('inventory_item_units_item_unit_unique').on(t.itemId, t.unitId),
    itemIdx: index('inventory_item_units_item_idx').on(t.itemId),
  }),
)

/**
 * Tier-based selling prices per (item, unit). The cashier picks the
 * highest tier whose `min_qty` is ≤ the line's qty. No matching tier
 * = item is not sellable at that unit (won't appear in the cashier
 * grid for that unit).
 *
 * Example for sugar with base = gram, alt = kg:
 *   (sugar, gram, 1, Rp 14)        → 1+ gram costs Rp 14/gram
 *   (sugar, gram, 1000, Rp 12)     → 1000+ gram bulk Rp 12/gram
 *   (sugar, kg,   1, Rp 13.500)    → 1+ kg costs Rp 13.500/kg
 *   (sugar, kg,   5, Rp 12.500)    → 5+ kg bulk Rp 12.500/kg
 *
 * Note: kg price is independently set, NOT auto-derived from gram ×
 * 1000 — merchants commonly price packs cheaper than the loose-weight
 * equivalent (or vice versa for retail markup).
 */
export const inventoryItemUnitPricing = pgTable(
  'inventory_item_unit_pricing',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: uuid('unit_id')
      .references(() => masterHppUnits.id)
      .notNull(),
    /** Tier kicks in at qty ≥ minQty. The tier-1 row has minQty = 1. */
    minQty: numeric('min_qty', { precision: 15, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('inventory_item_unit_pricing_unique').on(
      t.itemId,
      t.unitId,
      t.minQty,
    ),
    lookupIdx: index('inventory_item_unit_pricing_lookup_idx').on(
      t.itemId,
      t.unitId,
      t.minQty,
    ),
  }),
)

/**
 * Purchase orders (Toko+). Header table — line items live in
 * purchase_order_items below. Status transitions: draft → sent →
 * partial → received, or any state → cancelled.
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Atomic per-tenant counter — see purchase_order_counters below. */
    poNumber: text('po_number').notNull(),
    supplierId: uuid('supplier_id')
      .references(() => suppliers.id)
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id)
      .notNull(),
    /** 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'. */
    status: text('status').notNull().default('draft'),
    expectedAt: date('expected_at'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdBy: uuid('created_by').notNull(),
    receivedAt: timestamp('received_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqNumber: unique('purchase_orders_tenant_number_unique').on(
      t.tenantId,
      t.poNumber,
    ),
    statusChk: check(
      'purchase_orders_status_chk',
      sql`${t.status} IN ('draft', 'sent', 'partial', 'received', 'cancelled')`,
    ),
    tenantStatusIdx: index('purchase_orders_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
)

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id')
    .references(() => purchaseOrders.id, { onDelete: 'cascade' })
    .notNull(),
  itemId: uuid('item_id')
    .references(() => inventoryItems.id)
    .notNull(),
  /**
   * Ordered unit. NULL on legacy rows = the item's base unit. Ordered
   * qty, unit cost, and subtotal are all expressed in THIS unit.
   */
  unitId: uuid('unit_id').references(() => masterHppUnits.id),
  /**
   * Snapshot of inventory_item_units.ratioToBase at order time. Base
   * quantity = orderedQty * (unitRatio ?? 1). Snapshotting keeps an
   * in-flight PO stable if the unit definition is later edited.
   * NULL = 1 (base unit).
   */
  unitRatio: numeric('unit_ratio', { precision: 15, scale: 4 }),
  orderedQty: numeric('ordered_qty', { precision: 15, scale: 4 }).notNull(),
  receivedQty: numeric('received_qty', { precision: 15, scale: 4 })
    .notNull()
    .default('0'),
  unitCost: numeric('unit_cost', { precision: 15, scale: 2 }).notNull(),
  /**
   * Optional new selling price per base unit. Set when the user wants
   * to update the inventory item's `selling_price` upon receiving this
   * line — the typical reseller workflow ("bought at X, will sell at
   * Y"). NULL = leave the item's selling price unchanged on receive.
   */
  sellingPrice: numeric('selling_price', { precision: 15, scale: 2 }),
  subtotal: numeric('subtotal', { precision: 15, scale: 2 }).notNull(),
  notes: text('notes'),
})

/**
 * Atomic per-tenant PO counter — same pattern as the financial
 * invoice counter. Stored separately from purchaseOrders so the
 * `nextPoNumber` helper can do a single upsert + return without
 * locking the orders table.
 */
export const purchaseOrderCounters = pgTable('purchase_order_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nextSeq: integer('next_seq').notNull().default(1),
})

/**
 * Inter-branch stock requisitions (JUR-190). An outlet branch requests
 * stock from another branch (the main branch in v1); the source branch
 * approves, then fulfills — and fulfillment moves stock via paired
 * transfer_out / transfer_in `inventory_movements`. Header table; lines
 * live in stock_requisition_items below.
 *
 * Status: pending → approved → fulfilled, with rejected / cancelled as
 * terminal off-ramps. Stock moves only at fulfill (mirrors how a PO
 * touches stock only at receive, not at send).
 */
export const stockRequisitions = pgTable(
  'stock_requisitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    /** Atomic per-tenant counter — see stock_requisition_counters below. */
    requisitionNumber: text('requisition_number').notNull(),
    /** The outlet that needs stock. */
    requestingBranchId: uuid('requesting_branch_id')
      .references(() => branches.id)
      .notNull(),
    /** The branch fulfilling the request (the main branch in v1). */
    sourceBranchId: uuid('source_branch_id')
      .references(() => branches.id)
      .notNull(),
    /** 'pending' | 'approved' | 'fulfilled' | 'rejected' | 'cancelled'. */
    status: text('status').notNull().default('pending'),
    notes: text('notes'),
    /** Supabase auth user IDs. */
    requestedBy: uuid('requested_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at'),
    fulfilledAt: timestamp('fulfilled_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqNumber: unique('stock_requisitions_tenant_number_unique').on(
      t.tenantId,
      t.requisitionNumber,
    ),
    statusChk: check(
      'stock_requisitions_status_chk',
      sql`${t.status} IN ('pending', 'approved', 'fulfilled', 'rejected', 'cancelled')`,
    ),
    branchesDistinctChk: check(
      'stock_requisitions_branches_distinct_chk',
      sql`${t.requestingBranchId} <> ${t.sourceBranchId}`,
    ),
    tenantStatusIdx: index('stock_requisitions_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
)

export const stockRequisitionItems = pgTable('stock_requisition_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  requisitionId: uuid('requisition_id')
    .references(() => stockRequisitions.id, { onDelete: 'cascade' })
    .notNull(),
  itemId: uuid('item_id')
    .references(() => inventoryItems.id)
    .notNull(),
  /**
   * Ordered unit. NULL on legacy rows = the item's base unit. Requested
   * qty is expressed in THIS unit.
   */
  unitId: uuid('unit_id').references(() => masterHppUnits.id),
  /**
   * Snapshot of inventory_item_units.ratioToBase at request time. Base
   * quantity for the stock move = requestedQty * (unitRatio ?? 1).
   * Snapshotting keeps an in-flight requisition stable if the unit
   * definition is later edited. NULL = 1 (base unit).
   */
  unitRatio: numeric('unit_ratio', { precision: 15, scale: 4 }),
  requestedQty: numeric('requested_qty', { precision: 15, scale: 4 }).notNull(),
  /** Amount actually moved at fulfill time — may be < requested. */
  fulfilledQty: numeric('fulfilled_qty', { precision: 15, scale: 4 })
    .notNull()
    .default('0'),
  /**
   * Price per unit HQ charges the requesting branch — captured at
   * requisition time from the item's `franchise_price`. Set only when
   * the requesting branch is a franchise outlet; NULL for an
   * independent branch (a pure stock transfer, no money).
   */
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }),
  notes: text('notes'),
})

/**
 * Atomic per-tenant requisition counter — mirrors purchase_order_counters.
 * Number format: REQ-{YYYY}-{0001}.
 */
export const stockRequisitionCounters = pgTable('stock_requisition_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nextSeq: integer('next_seq').notNull().default(1),
})

/**
 * Product variant combinations (Phase 1). One row per generated combo of
 * the item's `variantConfig` dims — e.g. (value1='M', value2='Merah').
 * `value2` is '' for single-dimension items. Each combo carries its own
 * selling price, optional SKU, and optional photo; stock lives in
 * `inventory_item_variant_stock` (per branch).
 */
export const inventoryItemVariants = pgTable(
  'inventory_item_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    /** First dimension value (e.g. 'M'). */
    value1: text('value1').notNull(),
    /** Second dimension value (e.g. 'Merah'); '' when single-dimension. */
    value2: text('value2').notNull().default(''),
    sku: text('sku'),
    /** Per-variant selling price (absolute; defaults to the item price). */
    price: numeric('price', { precision: 15, scale: 2 }).notNull().default('0'),
    photoKey: text('photo_key'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    comboUnique: unique('inventory_item_variants_combo_unique').on(
      t.itemId,
      t.value1,
      t.value2,
    ),
    itemIdx: index('inventory_item_variants_item_idx').on(t.itemId),
  }),
)

/**
 * Per-(variant, branch) stock. Kept separate from
 * `inventory_stock_balances` (item-level, used by POS) so the existing
 * cashier stock path is untouched while variants are online-first.
 * `quantity` is in the item's base unit.
 */
export const inventoryItemVariantStock = pgTable(
  'inventory_item_variant_stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    variantId: uuid('variant_id')
      .references(() => inventoryItemVariants.id, { onDelete: 'cascade' })
      .notNull(),
    branchId: uuid('branch_id')
      .references(() => branches.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: numeric('quantity', { precision: 15, scale: 4 })
      .notNull()
      .default('0'),
    lastMovementAt: timestamp('last_movement_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique('inventory_item_variant_stock_unique').on(
      t.variantId,
      t.branchId,
    ),
  }),
)

/**
 * Additional storefront photos for an item (a gallery). The item's own
 * `photoKey` stays the cover/thumbnail used by POS, the inventory list,
 * and the catalog grid; these rows are *extra* images shown only on the
 * public product detail page. Item-level — shared across all variants.
 * Capped in the server function (a handful per item); 500 KB each, same
 * S3 bucket as the cover photo.
 */
export const inventoryItemPhotos = pgTable(
  'inventory_item_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    itemId: uuid('item_id')
      .references(() => inventoryItems.id, { onDelete: 'cascade' })
      .notNull(),
    photoKey: text('photo_key').notNull(),
    /** Display order within the gallery (after the cover). Lower = first. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    itemIdx: index('inventory_item_photos_item_idx').on(t.itemId),
  }),
)
