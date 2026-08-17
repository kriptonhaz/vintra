import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  unique,
  check,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './auth'
import { masterHppUnits } from './master-data'

export const tenantCategories = pgTable(
  'tenant_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    // Komplit situs visibility — false hides every product in this category
    // from the public storefront (q/<slug>) while keeping it ringable at
    // POS. Used for non-menu categories like Bungkus / packaging supplies.
    isVisibleOnSitus: boolean('is_visible_on_situs').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [unique('tenant_categories_tenant_id_name_unique').on(t.tenantId, t.name)],
)

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  name: text('name').notNull(),
  address: text('address'),
  phoneNumber: text('phone_number'),
  personInCharge: text('person_in_charge'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  name: text('name').notNull(),
  brand: text('brand'),
  /**
   * FK to master_hpp_units (post JUR-14). Was free-text `unit` pre-0028;
   * the migration backfilled from text → FK and dropped the text col.
   * Display label comes from joining master_hpp_units.label.
   */
  unitId: uuid('unit_id')
    .references(() => masterHppUnits.id)
    .notNull(),
  pricePerUnit: numeric('price_per_unit', { precision: 15, scale: 2 }).notNull(),
  purchasePrice: numeric('purchase_price', { precision: 15, scale: 2 }),
  purchaseQty: numeric('purchase_qty', { precision: 15, scale: 4 }),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  name: text('name').notNull(),
  sku: text('sku'),
  category: text('category'),
  sellingPrice: numeric('selling_price', { precision: 15, scale: 2 }).notNull(),
  hpp: numeric('hpp', { precision: 15, scale: 2 }),
  margin: numeric('margin', { precision: 5, scale: 2 }),
  productionQty: numeric('production_qty', { precision: 15, scale: 4 }),
  productionUnit: text('production_unit'),
  // Optional product photo — mirrors the inventory_items.photo_key
  // pattern. Stored as the S3/Supabase Storage object key; signed URLs
  // are minted on read. Display fallback: when null, /hpp table uses
  // the photo_key of the inventory_items row that links back via
  // linked_hpp_product_id (read-time only, never copied).
  photoKey: text('photo_key'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * BOM (bill-of-materials) row for an HPP product. Each row is either
 * material-sourced (`materialId` set) OR product-sourced
 * (`sourceProductId` set, for nested recipes / sub-products). Mutual
 * exclusion is enforced by a DB CHECK so every row commits to exactly
 * one source.
 *
 * The cashier ingredient deduction (JUR-10) reads only material-sourced
 * rows; product-sourced rows are persisted for future v2 recursion but
 * skipped on deduction in v1 (with a one-time tenant notification).
 */
export const productMaterials = pgTable(
  'product_materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    productId: uuid('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    /** Set when this BOM row references an atomic ingredient. Mutually
     *  exclusive with `sourceProductId` (DB CHECK). */
    materialId: uuid('material_id').references(() => materials.id),
    /** Set when this BOM row references a sub-product (nested recipe).
     *  v1 doesn't traverse these on stock deduction; v2 will. */
    sourceProductId: uuid('source_product_id').references(() => products.id, {
      onDelete: 'cascade',
    }),
    quantity: numeric('quantity', { precision: 15, scale: 4 }).notNull(),
    /** FK to master_hpp_units (post JUR-14). Same migration as materials.unit. */
    unitId: uuid('unit_id')
      .references(() => masterHppUnits.id)
      .notNull(),
    /**
     * JUR-15 v2: when in the cooking workflow this ingredient is added.
     *
     *   'prep'   (default) — consumed at prep batch time (or per sale
     *                        when prep_mode is off). The traditional
     *                        recipe assumption.
     *   'finish' — added per-cup at the counter even in prep mode
     *                        (e.g. gula/susu/sirup for warung kopi).
     *                        Skipped during recordPrepBatch; deducted
     *                        on each prep-mode sale.
     *
     * Meaningless for non-prep-mode items (default 'prep' keeps the
     * existing single-phase BOM walk). Free-tier HPP-only users can
     * still tag rows — the field is descriptive metadata until POS +
     * prep mode activates.
     */
    addAt: text('add_at').notNull().default('prep'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    productIdx: index('product_materials_product_idx').on(t.productId),
    sourceChk: check(
      'product_materials_source_chk',
      sql`(${t.materialId} IS NULL) <> (${t.sourceProductId} IS NULL)`,
    ),
    addAtChk: check(
      'product_materials_add_at_chk',
      sql`${t.addAt} IN ('prep', 'finish')`,
    ),
  }),
)

export const overheadCosts = pgTable('overhead_costs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id)
    .notNull(),
  name: text('name').notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  period: text('period').notNull().default('monthly'),
  allocationType: text('allocation_type').notNull().default('per_product'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Append-only ledger of every AUTOMATIC HPP movement.
 *
 * When an ingredient price or a recipe changes, every affected product is
 * recalculated. Without a record of that, "kenapa HPP naik bulan ini?" has no
 * answer — the old number is simply gone, and the owner is left comparing a
 * menu price against a cost whose history nobody kept.
 *
 * One row per product whose HPP actually moved, carrying what triggered it
 * and, where there is one, which material. Rows are never updated or deleted;
 * a correction is a new row.
 */
export const hppPriceHistory = pgTable(
  'hpp_price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id)
      .notNull(),
    productId: uuid('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    /** Batch cost before and after, same precision as `products.hpp`. */
    oldHpp: numeric('old_hpp', { precision: 15, scale: 2 }),
    newHpp: numeric('new_hpp', { precision: 15, scale: 2 }).notNull(),
    /**
     * Why it moved: 'material_price' | 'stock_in' | 'recipe' | 'manual'.
     * Text rather than an enum so a new trigger does not need a migration
     * before it can be recorded.
     */
    reason: text('reason').notNull(),
    /** The ingredient whose price triggered this, when there was one. */
    triggeredByMaterialId: uuid('triggered_by_material_id').references(
      () => materials.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantCreatedIdx: index('hpp_price_history_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    productCreatedIdx: index('hpp_price_history_product_created_idx').on(
      t.productId,
      t.createdAt,
    ),
  }),
)
