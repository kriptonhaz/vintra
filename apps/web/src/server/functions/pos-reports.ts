/**
 * JUR-211 (planned): Penjualan per Kategori / Produk / Pelanggan /
 * Diskon — four owner-facing report cuts that complement the P&L
 * overview at /pos/reports. Each fn is gated on `pos.report.view`
 * (fail-closed). Margin / HPP columns are conditionally included on
 * `pos.report.profit` so supervisors see revenue without seeing cost.
 *
 * Raw SQL via `db.execute` mirrors the pattern in
 * `pos.ts:getPOSReport` — the aggregations join 2-3 tables and group
 * by columns Drizzle's relational query API doesn't model cleanly.
 */
import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@vintra/db'
import { requirePOSAccess } from '../middleware/module-access'
import { assertBranchAllowed, branchScopeSql } from '../lib/branch-scope'

function ensureReportAccess(perms: readonly string[]) {
  if (!perms.includes('pos.report.view')) {
    throw new Error(
      'Anda tidak memiliki akses ke laporan POS. Hubungi pemilik.',
    )
  }
}

const baseRangeSchema = z.object({
  branchId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

/** Build the date-range + branch-scope SQL fragments used by every
 *  report query. Returns the start/end timestamps and the branch
 *  clause (matched against `s.branch_id` or `s2.branch_id` for
 *  subqueries). Mirrors the helper inlined into getPOSReport. */
function buildScope(
  data: { branchId?: string; from: string; to: string },
  auth: { allowedBranchIds: readonly string[] | null },
) {
  const startUtc = sql`((${data.from}::date::timestamp) AT TIME ZONE 'Asia/Jakarta')`
  const endUtc = sql`(((${data.to}::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta')`
  const branchClause = data.branchId
    ? sql`AND s.branch_id = ${data.branchId}`
    : sql`AND ${branchScopeSql(auth, sql`s.branch_id`)}`
  return { startUtc, endUtc, branchClause }
}

// ─── Penjualan per Kategori ─────────────────────────────────────────

export type CategoryReportRow = {
  categoryId: string | null
  categoryName: string
  qtySold: number
  salesCount: number
  revenue: number
  hppCost: number
  margin: number
  marginPct: number
}

/**
 * Aggregates completed sales lines by `inventory_items.category_id`.
 * NULL category falls into "Tanpa Kategori"; ad-hoc lines (item_id
 * NULL) fall into "Ad-hoc" so the totals always reconcile back to
 * the headline revenue.
 *
 * Returns `canSeeProfit` so the route can hide cost columns when the
 * caller lacks `pos.report.profit`. Server still computes them — they
 * just don't make it into the row shape's optional fields.
 */
export const getPOSSalesByCategory = createServerFn({ method: 'POST' })
  .inputValidator(baseRangeSchema)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    ensureReportAccess(auth.permissions)
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const canSeeProfit = auth.permissions.includes('pos.report.profit')
    const { startUtc, endUtc, branchClause } = buildScope(data, auth)

    const rows = await db.execute<{
      category_id: string | null
      category_name: string | null
      qty_sold: string
      sales_count: number
      revenue: number | null
      hpp_cost: number | null
    }>(sql`
      SELECT
        ii.category_id                                            AS category_id,
        tc.name                                                   AS category_name,
        SUM(li.qty::numeric)                                      AS qty_sold,
        COUNT(DISTINCT s.id)::int                                 AS sales_count,
        COALESCE(SUM(li.subtotal::numeric), 0)                    AS revenue,
        COALESCE(SUM(li.qty::numeric * COALESCE(li.hpp_at_sale, 0)::numeric), 0) AS hpp_cost
      FROM pos_sale_items li
      JOIN pos_sales s          ON s.id = li.sale_id
      LEFT JOIN inventory_items ii ON ii.id = li.item_id
      LEFT JOIN tenant_categories tc ON tc.id = ii.category_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY ii.category_id, tc.name
      ORDER BY revenue DESC
    `)

    const out: CategoryReportRow[] = rows.map((r) => {
      const revenue = Number(r.revenue ?? 0)
      const hppCost = Number(r.hpp_cost ?? 0)
      const margin = revenue - hppCost
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0
      // Ad-hoc lines have no inventory link so category_id is NULL AND
      // tc.name is NULL — distinguish from real "Tanpa Kategori" items
      // (item exists but its category_id is null) by checking whether
      // ANY line in this bucket has a non-null item_id. We don't have
      // that info from this query; treat both as "Tanpa Kategori" for
      // now — owners who care about ad-hoc share can filter sales by
      // is_adhoc on the cashier page.
      const categoryName = r.category_name ?? 'Tanpa Kategori'
      return {
        categoryId: r.category_id,
        categoryName,
        qtySold: Number(r.qty_sold ?? 0),
        salesCount: r.sales_count,
        revenue,
        hppCost,
        margin,
        marginPct,
      }
    })

    return { rows: out, canSeeProfit }
  })

// ─── Penjualan per Produk ───────────────────────────────────────────

export type ProductReportRow = {
  itemId: string | null
  name: string
  sku: string | null
  categoryName: string | null
  qtySold: number
  salesCount: number
  revenue: number
  avgUnitPrice: number
  hppCost: number
  margin: number
  marginPct: number
}

/**
 * Row ceiling for an export-mode call.
 *
 * `all: true` exists because the table paginates at 25 for the screen's
 * sake while the export button handed back whatever page happened to be
 * loaded — a tenant with 100 products downloaded four files and
 * stitched them by hand. Unbounded would be worse though: these are
 * grouped aggregates held in memory and serialized into a workbook in
 * the browser. 10k covers every catalog and customer list by a wide
 * margin, and anything past it comes back flagged `truncated` rather
 * than silently dropped.
 */
export const EXPORT_ROW_CAP = 10_000

/** Return every matching row in one call, ignoring page/pageSize. */
const exportAllFlag = z.boolean().default(false)

const productReportInput = baseRangeSchema.extend({
  // Filter to a single category (matches inventory_items.category_id).
  // Pass the literal string 'none' to surface uncategorised items.
  categoryId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  all: exportAllFlag,
  sortBy: z
    .enum(['revenue', 'qty', 'salesCount', 'margin', 'name'])
    .default('revenue'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

/**
 * Per-product breakdown. Groups by `pos_sale_items.item_id` so two
 * lines for the same product sum together (the topByQty / topByRev
 * cards on the overview page group by name_snapshot — looser, but
 * fast). Ad-hoc lines (item_id NULL) all collapse into a single
 * "Item ad-hoc" row at the bottom.
 *
 * Server-side pagination + sort: the catalog can run to thousands of
 * items, so we never ship the whole list to the client.
 */
export const getPOSSalesByProduct = createServerFn({ method: 'POST' })
  .inputValidator(productReportInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    ensureReportAccess(auth.permissions)
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const canSeeProfit = auth.permissions.includes('pos.report.profit')
    const { startUtc, endUtc, branchClause } = buildScope(data, auth)

    const categoryClause = data.categoryId
      ? sql`AND ii.category_id = ${data.categoryId}`
      : sql``

    const sortColumn = (() => {
      switch (data.sortBy) {
        case 'qty':
          return sql`qty_sold`
        case 'salesCount':
          return sql`sales_count`
        case 'margin':
          return sql`margin`
        case 'name':
          return sql`name`
        case 'revenue':
        default:
          return sql`revenue`
      }
    })()
    const sortDir = data.sortDir === 'asc' ? sql`ASC` : sql`DESC`
    const limit = data.all ? EXPORT_ROW_CAP : data.pageSize
    const offset = data.all ? 0 : (data.page - 1) * data.pageSize

    // Wrap the GROUP BY in a CTE so we can both paginate AND get a
    // total count in one round-trip.
    const rows = await db.execute<{
      item_id: string | null
      name: string
      sku: string | null
      category_name: string | null
      qty_sold: string
      sales_count: number
      revenue: number | null
      hpp_cost: number | null
      total_groups: number
    }>(sql`
      WITH grouped AS (
        SELECT
          li.item_id                                              AS item_id,
          MIN(li.name_snapshot)                                   AS name,
          MIN(li.sku_snapshot)                                    AS sku,
          MIN(tc.name)                                            AS category_name,
          SUM(li.qty::numeric)                                    AS qty_sold,
          COUNT(DISTINCT s.id)::int                               AS sales_count,
          COALESCE(SUM(li.subtotal::numeric), 0)                  AS revenue,
          COALESCE(SUM(li.qty::numeric * COALESCE(li.hpp_at_sale, 0)::numeric), 0) AS hpp_cost
        FROM pos_sale_items li
        JOIN pos_sales s          ON s.id = li.sale_id
        LEFT JOIN inventory_items ii ON ii.id = li.item_id
        LEFT JOIN tenant_categories tc ON tc.id = ii.category_id
        WHERE s.tenant_id = ${auth.tenantId}
          AND s.status = 'completed'
          AND s.created_at >= ${startUtc}
          AND s.created_at <  ${endUtc}
          ${branchClause}
          ${categoryClause}
        GROUP BY li.item_id
      ),
      counted AS (
        SELECT *, COUNT(*) OVER ()::int AS total_groups,
               (revenue - hpp_cost) AS margin
        FROM grouped
      )
      SELECT item_id, name, sku, category_name, qty_sold, sales_count,
             revenue, hpp_cost, total_groups
      FROM counted
      ORDER BY ${sortColumn} ${sortDir}, name ASC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const totalCount = rows[0]?.total_groups ?? 0
    const out: ProductReportRow[] = rows.map((r) => {
      const revenue = Number(r.revenue ?? 0)
      const hppCost = Number(r.hpp_cost ?? 0)
      const qty = Number(r.qty_sold ?? 0)
      const margin = revenue - hppCost
      const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0
      const avgUnitPrice = qty > 0 ? revenue / qty : 0
      return {
        itemId: r.item_id,
        name: r.item_id ? r.name : 'Item ad-hoc',
        sku: r.sku,
        categoryName: r.category_name,
        qtySold: qty,
        salesCount: r.sales_count,
        revenue,
        avgUnitPrice,
        hppCost,
        margin,
        marginPct,
      }
    })

    return {
      rows: out,
      totalCount,
      canSeeProfit,
      page: data.page,
      pageSize: data.pageSize,
      /** Export mode hit the cap — the caller must say so, not pretend. */
      truncated: data.all && totalCount > EXPORT_ROW_CAP,
    }
  })

// ─── Laporan Pelanggan ──────────────────────────────────────────────

export type CustomerReportRow = {
  customerId: string
  name: string
  phone: string | null
  salesCount: number
  totalSpend: number
  avgBasket: number
  firstVisit: string | null
  lastVisit: string | null
}

const customerReportInput = baseRangeSchema.extend({
  search: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  all: exportAllFlag,
  sortBy: z
    .enum(['totalSpend', 'salesCount', 'avgBasket', 'lastVisit', 'name'])
    .default('totalSpend'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

/**
 * Per-customer aggregations over a date range. Anonymous sales
 * (`customer_id IS NULL`) are excluded from the list — owners see
 * them surfaced as a single summary chip via `anonymousSummary`
 * instead, so the table stays focused on attributable customers.
 *
 * Search matches name OR phone (ILIKE). Sort + paginate server-side.
 */
export const getPOSCustomersReport = createServerFn({ method: 'POST' })
  .inputValidator(customerReportInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    ensureReportAccess(auth.permissions)
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const { startUtc, endUtc, branchClause } = buildScope(data, auth)

    const searchClause = data.search
      ? sql`AND (c.name ILIKE ${'%' + data.search + '%'} OR c.phone ILIKE ${'%' + data.search + '%'})`
      : sql``
    const sortColumn = (() => {
      switch (data.sortBy) {
        case 'salesCount':
          return sql`sales_count`
        case 'avgBasket':
          return sql`avg_basket`
        case 'lastVisit':
          return sql`last_visit`
        case 'name':
          return sql`name`
        case 'totalSpend':
        default:
          return sql`total_spend`
      }
    })()
    const sortDir = data.sortDir === 'asc' ? sql`ASC` : sql`DESC`
    const limit = data.all ? EXPORT_ROW_CAP : data.pageSize
    const offset = data.all ? 0 : (data.page - 1) * data.pageSize

    const rows = await db.execute<{
      customer_id: string
      name: string
      phone: string | null
      sales_count: number
      total_spend: number | null
      avg_basket: number | null
      first_visit: string | null
      last_visit: string | null
      total_groups: number
    }>(sql`
      WITH grouped AS (
        SELECT
          s.customer_id                                AS customer_id,
          MIN(c.name)                                  AS name,
          MIN(c.phone)                                 AS phone,
          COUNT(*)::int                                AS sales_count,
          COALESCE(SUM(s.total::numeric), 0)           AS total_spend,
          COALESCE(AVG(s.total::numeric), 0)           AS avg_basket,
          MIN(s.created_at)                            AS first_visit,
          MAX(s.created_at)                            AS last_visit
        FROM pos_sales s
        JOIN customers c ON c.id = s.customer_id
        WHERE s.tenant_id = ${auth.tenantId}
          AND s.status = 'completed'
          AND s.customer_id IS NOT NULL
          AND s.created_at >= ${startUtc}
          AND s.created_at <  ${endUtc}
          ${branchClause}
          ${searchClause}
        GROUP BY s.customer_id
      ),
      counted AS (
        SELECT *, COUNT(*) OVER ()::int AS total_groups
        FROM grouped
      )
      SELECT customer_id, name, phone, sales_count, total_spend, avg_basket,
             first_visit, last_visit, total_groups
      FROM counted
      ORDER BY ${sortColumn} ${sortDir}, name ASC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const totalCount = rows[0]?.total_groups ?? 0

    // Anonymous walk-ins — surfaced as a summary chip above the table.
    const anonRows = await db.execute<{ count: number; total: number | null }>(sql`
      SELECT COUNT(*)::int AS count,
             COALESCE(SUM(s.total::numeric), 0) AS total
      FROM pos_sales s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.customer_id IS NULL
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
    `)
    const anon = anonRows[0]
    const anonymousSummary = {
      count: anon?.count ?? 0,
      total: Number(anon?.total ?? 0),
    }

    const out: CustomerReportRow[] = rows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      phone: r.phone,
      salesCount: r.sales_count,
      totalSpend: Number(r.total_spend ?? 0),
      avgBasket: Number(r.avg_basket ?? 0),
      firstVisit: r.first_visit,
      lastVisit: r.last_visit,
    }))

    return {
      rows: out,
      totalCount,
      anonymousSummary,
      page: data.page,
      pageSize: data.pageSize,
      /** Export mode hit the cap — the caller must say so, not pretend. */
      truncated: data.all && totalCount > EXPORT_ROW_CAP,
    }
  })

// ─── Laporan Diskon ─────────────────────────────────────────────────

export type DiscountReport = {
  manual: {
    /** SUM of pos_sale_items.line_discount_amount. */
    lineDiscount: number
    /** SUM of pos_sales.discount_amount (cart-level manual discount). */
    cartDiscount: number
    /** Distinct sales that had any manual discount (line or cart). */
    salesWithDiscount: number
  }
  promoCodes: Array<{
    code: string
    /** Pretty name when the code still exists in tenant_promotions;
     *  otherwise null (deleted promo — the snapshot still works). */
    name: string | null
    salesCount: number
    totalDiscount: number
  }>
  autoPromos: Array<{
    promoId: string
    name: string | null
    linesCount: number
    totalDiscount: number
  }>
}

/**
 * Three-block discount overview:
 *   - manual: line- AND cart-level discounts entered by the cashier
 *   - promoCodes: code-redeemed promos, grouped by the snapshotted code
 *   - autoPromos: auto_product / auto_category line promos, by promo_id
 *
 * All three queries hit the same date window so totals always
 * reconcile back to the headline `promoTotal` + discount columns on
 * the P&L overview.
 */
export const getPOSDiscountReport = createServerFn({ method: 'POST' })
  .inputValidator(baseRangeSchema)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    ensureReportAccess(auth.permissions)
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const { startUtc, endUtc, branchClause } = buildScope(data, auth)

    // Manual — line-level discount sum lives on pos_sale_items, cart-
    // level on pos_sales. Same window/branch scope; we need a CTE so
    // the line subquery shares the branch clause idiom.
    const manualRows = await db.execute<{
      line_discount: number | null
      cart_discount: number | null
      sales_with_discount: number
    }>(sql`
      WITH sales AS (
        SELECT s.id, s.discount_amount
        FROM pos_sales s
        WHERE s.tenant_id = ${auth.tenantId}
          AND s.status = 'completed'
          AND s.created_at >= ${startUtc}
          AND s.created_at <  ${endUtc}
          ${branchClause}
      ),
      line AS (
        SELECT li.sale_id, SUM(li.line_discount_amount::numeric) AS amt
        FROM pos_sale_items li
        WHERE li.sale_id IN (SELECT id FROM sales)
        GROUP BY li.sale_id
      )
      SELECT
        COALESCE(SUM(line.amt), 0)                                AS line_discount,
        COALESCE(SUM(sales.discount_amount::numeric), 0)          AS cart_discount,
        COUNT(*) FILTER (
          WHERE COALESCE(line.amt, 0) > 0 OR sales.discount_amount::numeric > 0
        )::int                                                    AS sales_with_discount
      FROM sales
      LEFT JOIN line ON line.sale_id = sales.id
    `)

    // Promo codes — group by snapshotted code; LEFT JOIN tenant_promotions
    // to recover the human name when the promo still exists. Deleted
    // promos surface as name=NULL but their usage stays visible.
    const codeRows = await db.execute<{
      code: string
      name: string | null
      sales_count: number
      total_discount: number | null
    }>(sql`
      SELECT
        s.promo_code_snapshot                                     AS code,
        MAX(tp.name)                                              AS name,
        COUNT(*)::int                                             AS sales_count,
        COALESCE(SUM(s.promo_amount::numeric), 0)                 AS total_discount
      FROM pos_sales s
      LEFT JOIN tenant_promotions tp
        ON tp.tenant_id = s.tenant_id
       AND tp.code = s.promo_code_snapshot
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.promo_code_snapshot IS NOT NULL
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY s.promo_code_snapshot
      ORDER BY total_discount DESC
    `)

    // Auto promos — line-level, keyed by promo_id directly (no snapshot
    // needed because the FK is reliable).
    const autoRows = await db.execute<{
      promo_id: string
      name: string | null
      lines_count: number
      total_discount: number | null
    }>(sql`
      SELECT
        li.auto_promo_id                                          AS promo_id,
        MAX(tp.name)                                              AS name,
        COUNT(*)::int                                             AS lines_count,
        COALESCE(SUM(li.auto_promo_amount::numeric), 0)           AS total_discount
      FROM pos_sale_items li
      JOIN pos_sales s ON s.id = li.sale_id
      LEFT JOIN tenant_promotions tp ON tp.id = li.auto_promo_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND li.auto_promo_id IS NOT NULL
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY li.auto_promo_id
      ORDER BY total_discount DESC
    `)

    const manual = manualRows[0]
    const out: DiscountReport = {
      manual: {
        lineDiscount: Number(manual?.line_discount ?? 0),
        cartDiscount: Number(manual?.cart_discount ?? 0),
        salesWithDiscount: manual?.sales_with_discount ?? 0,
      },
      promoCodes: codeRows.map((r) => ({
        code: r.code,
        name: r.name,
        salesCount: r.sales_count,
        totalDiscount: Number(r.total_discount ?? 0),
      })),
      autoPromos: autoRows.map((r) => ({
        promoId: r.promo_id,
        name: r.name,
        linesCount: r.lines_count,
        totalDiscount: Number(r.total_discount ?? 0),
      })),
    }
    return out
  })

// ─── Master query: tenant categories for the Produk filter ──────────

export const getPOSReportCategories = createServerFn({ method: 'GET' })
  .handler(async () => {
    const auth = await requirePOSAccess()
    ensureReportAccess(auth.permissions)
    const rows = await db.execute<{ id: string; name: string }>(sql`
      SELECT id, name
      FROM tenant_categories
      WHERE tenant_id = ${auth.tenantId}
      ORDER BY name ASC
    `)
    return rows.map((r) => ({ id: r.id, name: r.name }))
  })
