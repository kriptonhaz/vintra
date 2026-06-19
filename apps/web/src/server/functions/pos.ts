import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  posSettings,
  posSales,
  posSaleItems,
  customers,
  customerLoyaltyBalances,
  customerLoyaltyMovements,
  posVoidCategories,
  loyaltyStampPrograms,
  loyaltyStampProgramItems,
  loyaltyStampProgramRewards,
  customerStampCards,
  customerStampMovements,
  inventoryItems,
  inventoryItemUnits,
  inventoryItemUnitPricing,
  inventoryItemPrepBatches,
  inventoryStockBalances,
  inventoryItemVariants,
  inventoryItemVariantStock,
  inventoryMovements,
  branches,
  branchSchedules,
  tenantCategories,
  products,
  masterHppUnits,
  notifications,
  tenantPromotions,
  promotionTargets,
  promoRedemptions,
} from '@vintra/db/schema'
import { normalizePhone } from './customers'
import { computePromoAmount } from './promotions'
import { cashStaleConfigSchema } from '../../lib/schemas/cash-stale'
import { and, eq, sql, desc, gte, lte, ilike, isNotNull, isNull, inArray } from 'drizzle-orm'
import {
  posTierLimits,
  type POSFeatureFlag,
  type POSPaymentMethod,
  type POSTierKey,
} from '@vintra/shared'
import { requirePOSAccess } from '../middleware/module-access'
import {
  writePosSaleCashflowEntry,
  removePosSaleCashflowEntry,
} from '../lib/cashflow-sync'
import {
  createSaleReceivable,
  applyKasbonPaymentFifo,
  mapPosMethodToArMethod,
} from '../lib/ar-sync'
import {
  assertBranchAllowed,
  filterBranchesByAccess,
  branchScopeWhere,
} from '../lib/branch-scope'
import {
  findOpenSession,
  insertCashMovement,
  CASH_DRAWER_OPEN_FIRST,
} from '../lib/cash-movement'
import {
  uploadPOSReceiptLogo,
  getPOSLogoSignedUrl,
  parseDataUrl,
  getInventoryPhotoSignedUrl,
} from '@/lib/s3-storage'
import { dateKeyJakarta, jakartaDayOfWeek, nowJakartaWallClock } from '@/lib/jakarta-time'
import { deductBomIngredients } from '../lib/bom-deduct'
import { consumePrepBatchesForLine } from './pos-prep'

// ─── Tier-cap + feature enforcement ──────────────────────────────────

/**
 * Daily transaction cap was removed across the board to match the
 * Indonesian market norm (Qasir, Loyverse, Pawoon all give free users
 * unlimited transactions). The function is kept as a no-op so existing
 * call sites stay compatible; conversion now relies on multi-outlet,
 * multi-cashier, and feature gates instead of artificial tx caps.
 */
async function assertCanRingSale(_tenantId: string, _tier: POSTierKey) {
  // intentionally no-op — see comment above
}

/**
 * Free tier locks the cashier role to one user-per-day. If today's
 * existing sales were rung up by a different user_id, refuse — same
 * message style as the SKU cap. Toko+ allows multiple cashiers up to
 * `cashierCap`; we collapse the same check there too (just with a
 * higher cap). This is approximate but matches the "1 cashier" Free
 * promise in practice.
 */
async function assertCashierAllowed(
  tenantId: string,
  tier: POSTierKey,
  cashierUserId: string,
) {
  const limits = posTierLimits(tier)
  if (limits.cashierCap == null) return

  const rows = await db.execute<{ cashier_user_id: string }>(sql`
    SELECT DISTINCT cashier_user_id
    FROM pos_sales
    WHERE tenant_id = ${tenantId}
      AND created_at >= ((now() AT TIME ZONE 'Asia/Jakarta')::date::timestamp) AT TIME ZONE 'Asia/Jakarta'
      AND created_at <  (((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta'
  `)
  const distinctUsers = new Set(rows.map((r) => r.cashier_user_id))
  // Always allow the user if they're already in today's set
  if (distinctUsers.has(cashierUserId)) return
  if (distinctUsers.size >= limits.cashierCap) {
    throw new Error(
      `Batas ${limits.cashierCap} kasir/hari tercapai untuk paket ini. Upgrade ke Toko untuk multi-kasir.`,
    )
  }
}

function assertPaymentMethodAllowed(
  tier: POSTierKey,
  method: POSPaymentMethod,
) {
  const limits = posTierLimits(tier)
  if (!limits.paymentMethods.includes(method)) {
    throw new Error(
      `Metode pembayaran ini hanya tersedia di paket Toko ke atas.`,
    )
  }
}

/**
 * Branch gate for createSale. Two checks, both unconditional:
 *
 *   1. POS toggle (JUR-205): the branch must have 'pos' in its
 *      enabledModules. Catches gudang / HR-only outlets (e.g. a
 *      tenant's "Pusat" used only for stock + attendance) that the
 *      cashier picker no longer exposes — defence in depth against
 *      a stale UI snapshot or a hostile client.
 *   2. Tier cap (Free = 1, Toko = 2, paid+ = unlimited): the
 *      branch must fall within the first N POS-enabled active
 *      branches by createdAt — same heuristic the cashier picker
 *      uses so the hidden UI and the server agree on "branch #1".
 *
 * Both passes filter by enabled_modules so a Free tenant who has a
 * non-POS warehouse plus one POS outlet still gets the outlet
 * counted as "branch #1" (not silently overridden by the warehouse).
 */
async function assertBranchAllowedForTier(
  tenantId: string,
  tier: POSTierKey,
  branchId: string,
) {
  // Pass 1: POS toggle — every tier, including unlimited Komplit.
  const [withPos] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.id, branchId),
        eq(branches.tenantId, tenantId),
        eq(branches.isActive, true),
        sql`'pos' = ANY(${branches.enabledModules})`,
      ),
    )
    .limit(1)
  if (!withPos) {
    throw new Error(
      'Cabang ini belum mengaktifkan modul POS. Aktifkan dari Data Master → Cabang.',
    )
  }

  // Pass 2: tier cap — Free/Toko only.
  const limits = posTierLimits(tier)
  if (limits.branchCap == null) return

  const allowed = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.tenantId, tenantId),
        eq(branches.isActive, true),
        sql`'pos' = ANY(${branches.enabledModules})`,
      ),
    )
    .orderBy(branches.createdAt)
    .limit(limits.branchCap)
  if (!allowed.some((b) => b.id === branchId)) {
    throw new Error(
      `Cabang ini tidak tersedia di paket ${tier}. Upgrade untuk akses cabang lebih banyak.`,
    )
  }
}

function assertPOSFeatureAvailable(tier: POSTierKey, feature: POSFeatureFlag) {
  const limits = posTierLimits(tier)
  if (!limits.features.includes(feature)) {
    throw new Error(
      `Fitur ini hanya tersedia di paket berbayar. Upgrade untuk mengaktifkan.`,
    )
  }
}

/**
 * Loyalty earn dispatch — single source of truth for both the cold
 * path in createSale and the redeem-aware re-compute under tx.
 *
 *   linear   → floor(spend × rate)
 *   per_step → floor(spend / stepAmount) × stepPoints
 *
 * Both modes floor — never round up — so a Rp 999 sale on a "1 pt
 * per Rp 1.000" config gives 0 points (matches the cashier-facing
 * "1 pt per 1k" expectation), and a Rp 14.999 sale on a "750 pt per
 * Rp 15.000" config also gives 0.
 *
 * Defensive: zero or missing config returns 0 (never throws so the
 * sale never gets stuck on a bad loyalty setup).
 */
export function computeLoyaltyEarn(
  spend: number,
  cfg: {
    mode: 'linear' | 'per_step'
    rate: number
    stepAmount: number
    stepPoints: number
  },
): number {
  if (spend <= 0) return 0
  if (cfg.mode === 'per_step') {
    if (cfg.stepAmount <= 0 || cfg.stepPoints <= 0) return 0
    return Math.floor(spend / cfg.stepAmount) * cfg.stepPoints
  }
  if (cfg.rate <= 0) return 0
  return Math.floor(spend * cfg.rate)
}

/**
 * Atomic per-tenant sale counter. Format: `JQU-YYYY-NNNNN`.
 *
 * Semantics: `next_seq` always points at the seq the NEXT sale will
 * use. We assign `next_seq - 1` to the current sale (after the
 * upsert bumps it). For the first-ever sale we INSERT with
 * `next_seq = 2` so the just-used number is 1 (not 0 — the
 * previous version inserted 1 then returned the inserted value
 * unchanged, which is why the very first sale ended up as
 * `JQU-YYYY-00000`).
 *
 * Resets cleanly when the year rolls over. Single upsert + RETURNING
 * is safe under concurrent inserts because PostgreSQL serialises the
 * row-level update on conflict.
 */
async function nextSaleNumber(
  tx: typeof db,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear()
  const [row] = await tx.execute<{ used_seq: number }>(sql`
    INSERT INTO pos_sale_counters (tenant_id, year, next_seq)
    VALUES (${tenantId}, ${year}, 2)
    ON CONFLICT (tenant_id) DO UPDATE
      SET year = ${year},
          next_seq = CASE
            WHEN pos_sale_counters.year = ${year}
              THEN pos_sale_counters.next_seq + 1
            ELSE 2
          END
    RETURNING (pos_sale_counters.next_seq - 1) AS used_seq
  `)
  const useSeq = Number(row?.used_seq ?? 1)
  return `JQU-${year}-${String(useSeq).padStart(5, '0')}`
}

// ─── Overview / dashboard ────────────────────────────────────────────

export const getPOSOverview = createServerFn()
  .inputValidator(
    z.object({ branchId: z.string().uuid().optional() }).optional(),
  )
  .handler(async ({ data }) => {
  const auth = await requirePOSAccess()
  const limits = posTierLimits(auth.posTier)

  // Branch scope: a single branch when the topbar switcher picks one,
  // otherwise the member's full allowed set (JUR-135 — `TRUE` for
  // unrestricted owner / impersonation / pre-JUR-135 members).
  const branchId = data?.branchId
  if (branchId) assertBranchAllowed(auth, branchId)
  const branchFilterSql = branchId
    ? sql`branch_id = ${branchId}`
    : auth.allowedBranchIds === null
      ? sql`TRUE`
      : sql`branch_id = ANY(${auth.allowedBranchIds}::uuid[])`

  const [todayRow] = await db.execute<{
    sales_count: number
    revenue: number | null
  }>(sql`
    SELECT count(*)::int AS sales_count,
           COALESCE(SUM(total::numeric), 0)::numeric AS revenue
    FROM pos_sales
    WHERE tenant_id = ${auth.tenantId}
      AND status = 'completed'
      AND ${branchFilterSql}
      AND created_at >= ((now() AT TIME ZONE 'Asia/Jakarta')::date::timestamp) AT TIME ZONE 'Asia/Jakarta'
      AND created_at <  (((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta'
  `)
  const salesCount = Number(todayRow?.sales_count ?? 0)
  const revenue = Number(todayRow?.revenue ?? 0)

  const recentSales = await db
    .select({
      id: posSales.id,
      saleNumber: posSales.saleNumber,
      total: posSales.total,
      paymentMethod: posSales.paymentMethod,
      createdAt: posSales.createdAt,
      status: posSales.status,
    })
    .from(posSales)
    .where(
      and(
        eq(posSales.tenantId, auth.tenantId),
        branchId
          ? eq(posSales.branchId, branchId)
          : branchScopeWhere(auth, posSales.branchId),
      ),
    )
    .orderBy(desc(posSales.createdAt))
    .limit(5)

  // All items sold today, ordered by qty desc. branchFilterSql lives on
  // the `s.branch_id` column via the join.
  const topItems = await db.execute<{
    name_snapshot: string
    qty_sold: string
  }>(sql`
    SELECT li.name_snapshot, SUM(li.qty::numeric) AS qty_sold
    FROM pos_sale_items li
    JOIN pos_sales s ON s.id = li.sale_id
    WHERE s.tenant_id = ${auth.tenantId}
      AND s.status = 'completed'
      AND ${
        branchId
          ? sql`s.branch_id = ${branchId}`
          : auth.allowedBranchIds === null
            ? sql`TRUE`
            : sql`s.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`
      }
      AND s.created_at >= ((now() AT TIME ZONE 'Asia/Jakarta')::date::timestamp) AT TIME ZONE 'Asia/Jakarta'
      AND s.created_at <  (((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta'
    GROUP BY li.name_snapshot
    ORDER BY qty_sold DESC
  `)

  return {
    tier: auth.posTier,
    caps: {
      salesPerDayCap: limits.salesPerDayCap,
      cashierCap: limits.cashierCap,
      branchCap: limits.branchCap,
      historyDays: limits.historyDays,
    },
    today: {
      salesCount,
      revenue,
      avgTicket: salesCount > 0 ? Math.round(revenue / salesCount) : 0,
    },
    paymentMethods: limits.paymentMethods,
    features: limits.features,
    recentSales,
    topItems: topItems.map((t) => ({
      name: t.name_snapshot,
      qtySold: Number(t.qty_sold),
    })),
  }
})

// ─── Sales series (mobile home chart) ────────────────────────────────
//
// Flexible bucketed revenue series for the home dashboard chart. The
// `period` switch is what the mobile dropdown (Harian/Mingguan/Bulanan/
// Tahunan) toggles — one endpoint, four windows:
//
//   daily   → last 7 days,   bucket = day
//   weekly  → last 8 weeks,  bucket = week (Postgres week = Mon-start)
//   monthly → last 12 months bucket = month
//   yearly  → last 5 years,  bucket = year
//
// All bucketing is in Asia/Jakarta wall-clock so "today" lines up with
// what the owner sees on the clock. Branch scope mirrors getPOSOverview.
//
// Returns the bucket array (for the chart) plus current/previous/delta
// derived from the last two buckets so the card can show the headline
// number + a "+X% vs periode lalu" badge without a second query.

const PERIOD_CONFIG = {
  daily: { unit: 'day', count: 7 },
  weekly: { unit: 'week', count: 8 },
  monthly: { unit: 'month', count: 12 },
  yearly: { unit: 'year', count: 5 },
} as const

export const getSalesSeries = createServerFn()
  .inputValidator(
    z.object({
      period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('daily'),
      branchId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    // Revenue visibility = pos.read. A cashier with only pos.transact
    // can ring sales but must not see the tenant's sales chart. The
    // mobile home hides the chart for the same permission, so client
    // and server agree; this is the defense-in-depth backstop.
    if (!auth.permissions.includes('pos.read')) {
      throw new Error('Forbidden')
    }

    const { unit, count } = PERIOD_CONFIG[data.period]

    const branchId = data.branchId
    if (branchId) assertBranchAllowed(auth, branchId)
    // Branch filter applied inside the LEFT JOIN's ON clause so empty
    // buckets still appear (zero-revenue days/weeks render a flat line).
    const branchFilterSql = branchId
      ? sql`AND s.branch_id = ${branchId}`
      : auth.allowedBranchIds === null
        ? sql``
        : sql`AND s.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`

    // `unit` and `count` come from the fixed PERIOD_CONFIG map (never
    // user input), so sql.raw is safe here.
    const unitSql = sql.raw(`'${unit}'`)
    const spanSql = sql.raw(`interval '${count - 1} ${unit}'`)
    const stepSql = sql.raw(`interval '1 ${unit}'`)

    const rows = await db.execute<{
      bucket_start: string
      revenue: number | null
    }>(sql`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${unitSql}, (now() AT TIME ZONE 'Asia/Jakarta')) - ${spanSql},
          date_trunc(${unitSql}, (now() AT TIME ZONE 'Asia/Jakarta')),
          ${stepSql}
        ) AS bucket_start
      )
      SELECT b.bucket_start::text AS bucket_start,
             COALESCE(SUM(s.total::numeric), 0)::numeric AS revenue
      FROM buckets b
      LEFT JOIN pos_sales s
        ON date_trunc(${unitSql}, (s.created_at AT TIME ZONE 'Asia/Jakarta')) = b.bucket_start
        AND s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        ${branchFilterSql}
      GROUP BY b.bucket_start
      ORDER BY b.bucket_start ASC
    `)

    const points = rows.map((r) => ({
      bucketStart: r.bucket_start,
      revenue: Number(r.revenue ?? 0),
    }))

    const current = points.at(-1)?.revenue ?? 0
    const previous = points.at(-2)?.revenue ?? 0
    const deltaPct =
      previous > 0
        ? Math.round(((current - previous) / previous) * 1000) / 10
        : null

    return {
      period: data.period,
      points,
      current,
      previous,
      deltaPct,
    }
  })

// ─── Cashier masters ─────────────────────────────────────────────────

const cashierMastersInput = z.object({
  branchId: z.string().uuid().optional(),
})

export const getPOSCashierMasters = createServerFn({ method: 'POST' })
  .inputValidator(cashierMastersInput)
  .handler(async ({ data: _data }) => {
    const auth = await requirePOSAccess()
    const limits = posTierLimits(auth.posTier)

    const [allBranchList, categoriesList, settingsRow] = await Promise.all([
      // Always order by createdAt so "the first branch" is stable across
      // requests — branchCap caps from the start of this list.
      // JUR-205: branches with the POS module toggled off (typically
      // gudang / warehouse + HR-only "Pusat") no longer appear in the
      // cashier picker. Before this, tenant-level POS feature flags
      // (promo, stamp, loyalty) would leak through to any branch the
      // cashier could pick — including non-POS ones.
      db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, auth.tenantId),
            eq(branches.isActive, true),
            sql`'pos' = ANY(${branches.enabledModules})`,
          ),
        )
        .orderBy(branches.createdAt),
      db
        .select({ id: tenantCategories.id, name: tenantCategories.name })
        .from(tenantCategories)
        .where(eq(tenantCategories.tenantId, auth.tenantId))
        .orderBy(tenantCategories.sortOrder),
      db
        .select({
          taxes: posSettings.taxes,
          defaultPaymentMethods: posSettings.defaultPaymentMethods,
          loyaltyEnabled: posSettings.loyaltyEnabled,
          loyaltyEarnMode: posSettings.loyaltyEarnMode,
          loyaltyEarnRate: posSettings.loyaltyEarnRate,
          loyaltyEarnStepAmount: posSettings.loyaltyEarnStepAmount,
          loyaltyEarnStepPoints: posSettings.loyaltyEarnStepPoints,
          loyaltyRedeemRate: posSettings.loyaltyRedeemRate,
          cashDrawerEnabled: posSettings.cashDrawerEnabled,
          cashVarianceThreshold: posSettings.cashVarianceThreshold,
          adhocItemsEnabled: posSettings.adhocItemsEnabled,
        })
        .from(posSettings)
        .where(eq(posSettings.tenantId, auth.tenantId))
        .limit(1),
    ])

    const settings = settingsRow[0]
    // Tier-allowed methods ∩ tenant-configured methods. Free tenants
    // can't extend beyond cash + qris even if they somehow set a wider
    // list (defence in depth — tier filter wins).
    const tenantSet = new Set(
      (settings?.defaultPaymentMethods ?? ['cash', 'qris']) as POSPaymentMethod[],
    )
    const allowedPaymentMethods = limits.paymentMethods.filter((m) =>
      tenantSet.has(m),
    )

    // Tier-cap the branch list. Free = 1, Toko = 2, paid+ = unlimited.
    // Cashier UI hides the picker when only 1 option; createSale also
    // re-validates so a malicious client can't bypass by passing a
    // disallowed branchId.
    const tierCappedBranches =
      limits.branchCap != null
        ? allBranchList.slice(0, limits.branchCap)
        : allBranchList
    // JUR-135: intersect with the member's per-branch access. Owners
    // and pre-JUR-135 members pass through unchanged.
    const branchList = filterBranchesByAccess(auth, tierCappedBranches)
    // Flag so the cashier UI can pick the right empty-state message:
    // restricted-with-zero ("hubungi pemilik") vs tenant-with-zero
    // ("tambah cabang"). Branches were filtered only when the tier
    // cap or branch access actually removed something.
    const branchAccessRestricted =
      auth.allowedBranchIds !== null && branchList.length < tierCappedBranches.length

    return {
      tier: auth.posTier,
      branches: branchList,
      branchAccessRestricted,
      categories: categoriesList,
      paymentMethods:
        allowedPaymentMethods.length > 0
          ? allowedPaymentMethods
          : limits.paymentMethods.slice(0, 1),
      // Active tax stack — only the rows the tenant marked active.
      // Cashier preview + payment modal sum these; receipts render
      // each line. Free-tenants who never set anything get an empty
      // array so the cart hides the tax line entirely.
      taxes: ((settings?.taxes ?? []) as Array<{
        label: string
        percent: number
        active: boolean
      }>)
        .filter((t) => t.active && t.percent > 0)
        .map((t) => ({ label: t.label, percent: Number(t.percent) })),
      // Loyalty config exposed to the cashier so the picker can
      // compute "≈ Rp X" + show the redeem checkbox without an extra
      // round-trip. Active only when both tier feature + tenant
      // toggle agree — server re-validates anyway.
      loyalty: {
        active:
          limits.features.includes('loyalty_points') &&
          Boolean(settings?.loyaltyEnabled),
        // JUR-195: stamp cards are gated on the tier feature only —
        // independent of the points `loyaltyEnabled` toggle, since a
        // tenant may run punch cards without the points program.
        stampActive: limits.features.includes('loyalty_points'),
        earnMode:
          (settings?.loyaltyEarnMode as 'linear' | 'per_step' | undefined) ??
          'linear',
        earnRate: Number(settings?.loyaltyEarnRate ?? 0.001),
        earnStepAmount: Number(settings?.loyaltyEarnStepAmount ?? 0),
        earnStepPoints: Number(settings?.loyaltyEarnStepPoints ?? 0),
        redeemRate: Number(settings?.loyaltyRedeemRate ?? 10),
      },
      // JUR-141 Peti Kas. JUR-145 PR 4: feature is Komplit-only.
      // We AND the tenant toggle with the tier check so free /
      // legacy-tier tenants never see the BukaKasModal even if a
      // stray DB row sets cash_drawer_enabled=true. PR 2 cashier UI
      // gates everything off this single `enabled` boolean.
      cashDrawer: {
        enabled:
          auth.posTier === 'komplit' &&
          (settings?.cashDrawerEnabled ?? true),
        varianceThreshold: Number(settings?.cashVarianceThreshold ?? 10000),
      },
      // Anti-fraud "Item Lain" gate. Defaults false (opt-in) for
      // tenants with no settings row yet. The cashier hides the button
      // when false; createSale re-checks server-side.
      allowAdhocItems: settings?.adhocItemsEnabled ?? false,
      features: limits.features,
    }
  })

// ─── Product listing for cashier grid ────────────────────────────────

const listProductsInput = z.object({
  branchId: z.string().uuid(),
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  /**
   * Targeted lookup mode (JUR-195). When set, the catalog grid filters
   * are ignored and only items in this list are returned — used by the
   * cashier to auto-add stamp-reward items that aren't necessarily in
   * the current category / search view. Capped at 50 to keep the
   * single-pass joins bounded.
   */
  itemIds: z.array(z.string().uuid()).max(50).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(60),
})

export const listPOSProducts = createServerFn({ method: 'POST' })
  .inputValidator(listProductsInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    // JUR-135: product grid is per-branch (joins inventory_stock_balances
    // on branchId). Restrict which branches the cashier can ask about.
    assertBranchAllowed(auth, data.branchId)

    const conds = [
      eq(inventoryItems.tenantId, auth.tenantId),
      eq(inventoryItems.isActive, true),
      // Hide non-sellable inventory items (raw ingredients tagged via
      // is_sellable=false) from the cashier grid. Admin can flip the
      // toggle on the inventory form for the bahan-baku-store edge
      // case where they DO sell ingredients.
      eq(inventoryItems.isSellable, true),
    ]
    // Targeted lookup wins over search/category — when itemIds is set
    // the caller wants exactly these rows back regardless of which
    // category/search the catalog grid is currently filtered to.
    if (data.itemIds && data.itemIds.length > 0) {
      conds.push(inArray(inventoryItems.id, data.itemIds))
    } else {
      if (data.search) {
        conds.push(ilike(inventoryItems.name, `%${data.search}%`))
      }
      if (data.categoryId) {
        conds.push(eq(inventoryItems.categoryId, data.categoryId))
      }
    }

    const offset = (data.page - 1) * data.pageSize
    // Single-pass query: items + their base-unit info + stock at the
    // current branch + EVERY configured unit + EVERY pricing tier.
    // We then build a nested per-item shape on the JS side.
    //
    // Filter at the WHERE level: only items with at least one tier
    // (any unit, any min_qty) appear in the cashier grid.
    const itemRows = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        photoKey: inventoryItems.photoKey,
        categoryId: inventoryItems.categoryId,
        baseUnitId: inventoryItems.baseUnitId,
        baseUnitLabel: masterHppUnits.label,
        balance: inventoryStockBalances.quantity,
        linkedHppProductId: inventoryItems.linkedHppProductId,
        prepMode: inventoryItems.prepMode,
        isFavorite: inventoryItems.isFavorite,
        hasVariants: inventoryItems.hasVariants,
      })
      .from(inventoryItems)
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, inventoryItems.baseUnitId))
      .leftJoin(
        inventoryStockBalances,
        and(
          eq(inventoryStockBalances.itemId, inventoryItems.id),
          eq(inventoryStockBalances.branchId, data.branchId),
        ),
      )
      .where(and(...conds))
      // Favorites pin to the top of the "Semua" (all-categories) view —
      // pushes best-sellers / staples up so cashiers don't scroll. We
      // also apply the sort when a category IS selected; inside one
      // category there's usually only 0–1 favorites so it's a no-op
      // visually but keeps ordering deterministic regardless of view.
      .orderBy(desc(inventoryItems.isFavorite), inventoryItems.name)
      .limit(data.pageSize)
      .offset(offset)

    if (itemRows.length === 0) return { items: [] }

    const itemIds = itemRows.map((r) => r.id)

    // All units configured for these items.
    const unitRows = await db
      .select({
        itemId: inventoryItemUnits.itemId,
        unitId: inventoryItemUnits.unitId,
        unitLabel: masterHppUnits.label,
        ratioToBase: inventoryItemUnits.ratioToBase,
        sortOrder: inventoryItemUnits.sortOrder,
        isDefault: inventoryItemUnits.isDefault,
      })
      .from(inventoryItemUnits)
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, inventoryItemUnits.unitId))
      .where(inArray(inventoryItemUnits.itemId, itemIds))
      .orderBy(inventoryItemUnits.sortOrder, masterHppUnits.label)

    // All pricing tiers for these items, ordered by min_qty asc so
    // cashier tier-pickers can iterate in order.
    const tierRows = await db
      .select({
        itemId: inventoryItemUnitPricing.itemId,
        unitId: inventoryItemUnitPricing.unitId,
        minQty: inventoryItemUnitPricing.minQty,
        unitPrice: inventoryItemUnitPricing.unitPrice,
      })
      .from(inventoryItemUnitPricing)
      .where(inArray(inventoryItemUnitPricing.itemId, itemIds))
      .orderBy(
        inventoryItemUnitPricing.itemId,
        inventoryItemUnitPricing.unitId,
        inventoryItemUnitPricing.minQty,
      )

    // JUR-15: aggregate "Siap" (= sum of open prep batch counter) for
    // prep-mode items in this branch. Skips items where prepMode=false
    // so a tenant with thousands of non-prep items doesn't pay for the
    // aggregation. Open-rows partial index handles the WHERE.
    const prepItemIds = itemRows.filter((r) => r.prepMode).map((r) => r.id)
    const prepSiapByItem = new Map<string, number>()
    if (prepItemIds.length > 0) {
      const prepRows = await db
        .select({
          itemId: inventoryItemPrepBatches.itemId,
          siapInBase: sql<string>`COALESCE(SUM(${inventoryItemPrepBatches.qtyPrepared} - ${inventoryItemPrepBatches.qtyConsumed}), 0)::text`,
        })
        .from(inventoryItemPrepBatches)
        .where(
          and(
            eq(inventoryItemPrepBatches.tenantId, auth.tenantId),
            eq(inventoryItemPrepBatches.branchId, data.branchId),
            inArray(inventoryItemPrepBatches.itemId, prepItemIds),
            sql`${inventoryItemPrepBatches.qtyConsumed} < ${inventoryItemPrepBatches.qtyPrepared}`,
          ),
        )
        .groupBy(inventoryItemPrepBatches.itemId)
      for (const r of prepRows) {
        prepSiapByItem.set(r.itemId, Number(r.siapInBase))
      }
    }

    // Bucket tiers by (item, unit) for O(1) attach below.
    const tiersByKey = new Map<
      string,
      Array<{ minQty: number; unitPrice: number }>
    >()
    for (const t of tierRows) {
      const key = `${t.itemId}|${t.unitId}`
      const arr = tiersByKey.get(key) ?? []
      arr.push({ minQty: Number(t.minQty), unitPrice: Number(t.unitPrice) })
      tiersByKey.set(key, arr)
    }

    // Bucket units by item; attach tiers; drop units with no tiers
    // (admin configured the unit but didn't price it — not yet sellable).
    interface PosUnit {
      unitId: string
      unitLabel: string
      ratioToBase: number
      isDefault: boolean
      tiers: Array<{ minQty: number; unitPrice: number }>
    }
    const unitsByItem = new Map<string, PosUnit[]>()
    for (const u of unitRows) {
      const tiers = tiersByKey.get(`${u.itemId}|${u.unitId}`) ?? []
      if (tiers.length === 0) continue
      const arr = unitsByItem.get(u.itemId) ?? []
      arr.push({
        unitId: u.unitId,
        unitLabel: u.unitLabel,
        ratioToBase: Number(u.ratioToBase),
        isDefault: u.isDefault,
        tiers,
      })
      unitsByItem.set(u.itemId, arr)
    }

    // Variants for variant items, with per-branch stock at the cashier's
    // branch. Variant items price + stock come from here (not the unit
    // tiers), so they appear in the grid even without priced units.
    const variantItemIds = itemRows.filter((r) => r.hasVariants).map((r) => r.id)
    const variantsByItem = new Map<
      string,
      Array<{
        id: string
        value1: string
        value2: string
        label: string
        sku: string | null
        price: number
        stockInBase: number
      }>
    >()
    if (variantItemIds.length > 0) {
      const vRows = await db
        .select({
          id: inventoryItemVariants.id,
          itemId: inventoryItemVariants.itemId,
          value1: inventoryItemVariants.value1,
          value2: inventoryItemVariants.value2,
          sku: inventoryItemVariants.sku,
          price: inventoryItemVariants.price,
          sortOrder: inventoryItemVariants.sortOrder,
          stock: inventoryItemVariantStock.quantity,
        })
        .from(inventoryItemVariants)
        .leftJoin(
          inventoryItemVariantStock,
          and(
            eq(inventoryItemVariantStock.variantId, inventoryItemVariants.id),
            eq(inventoryItemVariantStock.branchId, data.branchId),
          ),
        )
        .where(
          and(
            inArray(inventoryItemVariants.itemId, variantItemIds),
            eq(inventoryItemVariants.isActive, true),
          ),
        )
        .orderBy(inventoryItemVariants.sortOrder)
      for (const v of vRows) {
        const arr = variantsByItem.get(v.itemId) ?? []
        arr.push({
          id: v.id,
          value1: v.value1,
          value2: v.value2,
          label: v.value2 ? `${v.value1} / ${v.value2}` : v.value1,
          sku: v.sku,
          price: Number(v.price),
          stockInBase: Number(v.stock ?? 0),
        })
        variantsByItem.set(v.itemId, arr)
      }
    }

    // Build the final list. Non-variant items with no priced units are
    // filtered out; variant items always pass (they carry their own
    // price + stock per combo) with a synthesized base unit.
    const items = itemRows
      .map((r) => {
        const isVariant = r.hasVariants
        const variants = isVariant ? (variantsByItem.get(r.id) ?? []) : []
        const units = isVariant
          ? [
              {
                unitId: r.baseUnitId,
                unitLabel: r.baseUnitLabel,
                ratioToBase: 1,
                isDefault: true,
                tiers: [] as Array<{ minQty: number; unitPrice: number }>,
              },
            ]
          : (unitsByItem.get(r.id) ?? [])
        if (!isVariant && units.length === 0) return null
        return {
          id: r.id,
          name: r.name,
          sku: r.sku,
          baseUnitId: r.baseUnitId,
          baseUnitLabel: r.baseUnitLabel,
          photoKey: r.photoKey,
          categoryId: r.categoryId,
          hasVariants: isVariant,
          variants,
          stockInBase: isVariant
            ? variants.reduce((n, v) => n + v.stockInBase, 0)
            : Number(r.balance ?? 0),
          // Service-mode flag — recipe-backed items are made-to-order
          // from BOM ingredients, so they have no own stock balance.
          // Cashier grid renders an "Auto" badge instead of "Stok: N",
          // doesn't gate add-to-cart on stockInBase, and the sale path
          // skips the item-level out movement (only walks BOM).
          recipeBacked: Boolean(r.linkedHppProductId),
          // JUR-15: prep-mode override for recipe-backed items. When
          // true, the cashier tile shows "Siap: N" instead of "Auto"
          // and disables the tile when siapInBase = 0.
          prepMode: r.prepMode,
          siapInBase: r.prepMode ? (prepSiapByItem.get(r.id) ?? 0) : null,
          // Pin-to-top flag — also informs the optional star badge on
          // the cashier tile so the cashier can see which items are
          // explicit favorites vs which just happen to sort high.
          isFavorite: r.isFavorite,
          units,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    // Sign each product photo into a short-lived GET URL so the mobile
    // catalog can render it (photos are private S3 objects, same as the
    // inventory detail page). Signing is a local crypto op (no network),
    // so a page of products is cheap; a missing/failed sign degrades to
    // the placeholder rather than failing the whole list.
    const itemsWithPhotos = await Promise.all(
      items.map(async (it) => ({
        ...it,
        photoUrl: it.photoKey
          ? await getInventoryPhotoSignedUrl(it.photoKey, 300).catch(() => null)
          : null,
      })),
    )

    return { items: itemsWithPhotos }
  })

// ─── Sale creation (atomic) ──────────────────────────────────────────

const saleLineInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  /**
   * Chosen variant for variant items. Required when the item has
   * variants; the server re-prices from the variant and deducts
   * per-variant stock.
   */
  variantId: z.string().uuid().nullable().optional(),
  /** Required for ad-hoc lines; ignored when itemId is set (snapshot taken from item). */
  name: z.string().min(1).max(200).optional(),
  /**
   * Sold-unit id. Required for non-adhoc lines so the server can look
   * up the tier price + ratio. Ad-hoc lines may omit it.
   */
  unitId: z.string().uuid().optional().nullable(),
  /** Quantity in the sold unit (e.g. 2 kg). */
  qty: z.coerce.number().positive('Jumlah harus lebih dari 0'),
  /**
   * Ad-hoc lines pass their own unit price (server trusts it).
   * Non-adhoc lines: server IGNORES whatever the client sends and
   * looks up the matching tier from inventory_item_unit_pricing.
   * This guarantees tier integrity even if the client clock-drifts.
   */
  unitPrice: z.coerce.number().min(0),
  isAdhoc: z.boolean().optional().default(false),
  /**
   * Per-line discount (JUR-7). Optional. Server validates the
   * computed Rp amount stays ≤ qty × unitPrice so a line can't go
   * negative. Tier-gated on `line_discount` (Toko+); Free attempts
   * to send this throw at server level.
   */
  lineDiscount: z
    .object({
      type: z.enum(['fixed', 'percent']),
      value: z.coerce.number().min(0),
    })
    .optional()
    .nullable(),
})

const createSaleInput = z.object({
  branchId: z.string().uuid(),
  lines: z.array(saleLineInput).min(1, 'Tambah minimal 1 item ke keranjang'),
  paymentMethod: z.enum(['cash', 'qris', 'transfer', 'card', 'ewallet', 'gopay', 'shopeepay', 'ovo']),
  paidAmount: z.coerce.number().min(0),
  customerName: z.string().max(100).optional().nullable(),
  customerPhone: z.string().max(20).optional().nullable(),
  discount: z
    .object({
      type: z.enum(['fixed', 'percent']),
      value: z.coerce.number().min(0),
    })
    .optional()
    .nullable(),
  /**
   * Loyalty redemption (Komplit `loyalty_points` feature). Number of
   * points the customer wants to spend on this sale. Server validates:
   *   - tier has loyalty_points feature
   *   - settings.loyaltyEnabled = true
   *   - customer is attached (customerId resolved during the sale)
   *   - redeemPoints ≤ customer's current balance
   *   - redeemPoints * redeemRate ≤ subtotal - discountAmount
   * Ignored otherwise (no error — we just don't redeem).
   */
  redeemPoints: z.coerce.number().min(0).optional().nullable(),
  /**
   * Promo code (JUR-9). Optional. Server re-validates against
   * tenant_promotions on save (anti-tamper) — same path as
   * validatePromoCode but inside the sale tx so caps + redemption
   * ledger update atomically.
   */
  promoCode: z.string().max(50).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  /**
   * JUR-191 kasbon. `isKasbon` lets the sale be rung with `paidAmount`
   * below the cart total — the gap becomes a new `ar_receivables` row.
   * `kasbonPayment` pays down the customer's existing kasbon FIFO.
   * Both require an attached customer + the Komplit `cashflow` feature.
   */
  isKasbon: z.boolean().optional(),
  kasbonPayment: z.coerce.number().min(0).optional(),
  /**
   * JUR-195 stamp redemptions. List of loyalty_stamp_program ids the
   * customer is redeeming a free reward for on this sale. For each id
   * the cart must already carry the program's reward item as a free
   * (100%-discounted) line, and the customer's card must hold enough
   * stamps. Requires an attached customer.
   */
  stampRedemptions: z.array(z.string().uuid()).optional().nullable(),
})

export const createSale = createServerFn({ method: 'POST' })
  .inputValidator(createSaleInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    // Tier gates BEFORE we touch any data — fail fast with friendly error.
    await assertCanRingSale(auth.tenantId, auth.posTier)
    await assertCashierAllowed(auth.tenantId, auth.posTier, auth.userId)
    await assertBranchAllowedForTier(auth.tenantId, auth.posTier, data.branchId)
    // JUR-135: per-member branch pin — gates writes after the tier
    // gate (so the user sees the tier error first if both apply).
    assertBranchAllowed(auth, data.branchId)
    assertPaymentMethodAllowed(auth.posTier, data.paymentMethod)
    if (data.discount) {
      assertPOSFeatureAvailable(auth.posTier, 'sale_discount')
    }
    if (data.customerName || data.customerPhone) {
      assertPOSFeatureAvailable(auth.posTier, 'customer_capture')
    }

    // JUR-191 kasbon gates. A credit sale OR a kasbon pay-down both
    // need the Komplit `cashflow` feature and an attached customer
    // (kasbon is keyed to customer_id, same as loyalty).
    const wantsKasbon = data.isKasbon === true
    const kasbonPaymentAmount = data.kasbonPayment ?? 0
    if (wantsKasbon || kasbonPaymentAmount > 0) {
      if (!posTierLimits(auth.posTier).features.includes('cashflow')) {
        throw new Error('Fitur kasbon hanya tersedia di paket Komplit.')
      }
      if (!data.customerName?.trim() || !data.customerPhone?.trim()) {
        throw new Error(
          'Kasbon membutuhkan data pelanggan (nama & nomor HP).',
        )
      }
    }

    // Validate branch belongs to tenant.
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.id, data.branchId),
          eq(branches.tenantId, auth.tenantId),
          eq(branches.isActive, true),
        ),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak valid')

    // JUR-141 Peti Kas: cash payments require an open session when
    // the feature is enabled. JUR-145 PR 4: feature is Komplit-only,
    // so free / legacy tenants short-circuit regardless of the
    // tenant toggle. Resolve once here so we can reuse the session
    // id inside the transaction.
    let cashSessionId: string | null = null
    if (data.paymentMethod === 'cash' && auth.posTier === 'komplit') {
      const [settingsRow] = await db
        .select({ enabled: posSettings.cashDrawerEnabled })
        .from(posSettings)
        .where(eq(posSettings.tenantId, auth.tenantId))
        .limit(1)
      if (settingsRow?.enabled ?? true) {
        const session = await findOpenSession(
          auth.tenantId,
          data.branchId,
          auth.userId,
        )
        if (!session) throw new Error(CASH_DRAWER_OPEN_FIRST)
        cashSessionId = session.id
      }
    }

    // Resolve all referenced items + their HPP-product cost in one go.
    const itemIds = data.lines
      .map((l) => l.itemId)
      .filter((id): id is string => Boolean(id))
    const itemRows =
      itemIds.length > 0
        ? await db
            .select({
              id: inventoryItems.id,
              name: inventoryItems.name,
              sku: inventoryItems.sku,
              costPrice: inventoryItems.costPrice,
              categoryId: inventoryItems.categoryId,
              linkedHppProductId: inventoryItems.linkedHppProductId,
              prepMode: inventoryItems.prepMode,
              hasVariants: inventoryItems.hasVariants,
              baseUnitId: inventoryItems.baseUnitId,
            })
            .from(inventoryItems)
            .where(
              and(
                eq(inventoryItems.tenantId, auth.tenantId),
                eq(inventoryItems.isActive, true),
                inArray(inventoryItems.id, itemIds),
              ),
            )
        : []

    const linkedProductIds = itemRows
      .map((i) => i.linkedHppProductId)
      .filter((id): id is string => Boolean(id))
    const productHpps =
      linkedProductIds.length > 0
        ? await db
            .select({
              id: products.id,
              hpp: products.hpp,
            })
            .from(products)
            .where(inArray(products.id, linkedProductIds))
        : []
    const hppByProductId = new Map(
      productHpps.map((p) => [p.id, Number(p.hpp ?? 0)]),
    )
    const itemMap = new Map(itemRows.map((i) => [i.id, i]))

    // Resolve variant rows for any variant lines — authoritative price +
    // label + SKU snapshot. Stock is checked/deducted separately.
    const lineVariantIds = data.lines
      .map((l) => l.variantId)
      .filter((id): id is string => Boolean(id))
    const variantMap = new Map<
      string,
      { id: string; itemId: string; label: string; price: number; sku: string | null }
    >()
    if (lineVariantIds.length > 0) {
      const vRows = await db
        .select({
          id: inventoryItemVariants.id,
          itemId: inventoryItemVariants.itemId,
          value1: inventoryItemVariants.value1,
          value2: inventoryItemVariants.value2,
          price: inventoryItemVariants.price,
          sku: inventoryItemVariants.sku,
          isActive: inventoryItemVariants.isActive,
        })
        .from(inventoryItemVariants)
        .where(
          and(
            eq(inventoryItemVariants.tenantId, auth.tenantId),
            inArray(inventoryItemVariants.id, lineVariantIds),
            eq(inventoryItemVariants.isActive, true),
          ),
        )
      for (const v of vRows) {
        variantMap.set(v.id, {
          id: v.id,
          itemId: v.itemId,
          label: v.value2 ? `${v.value1} / ${v.value2}` : v.value1,
          price: Number(v.price),
          sku: v.sku,
        })
      }
    }

    // Pull units + tiers for every (item, unit) pair the client sent.
    // Indexed by `${itemId}|${unitId}` for O(1) tier lookup below.
    const unitKeys = data.lines
      .filter((l) => l.itemId && l.unitId && !l.isAdhoc)
      .map((l) => ({ itemId: l.itemId!, unitId: l.unitId! }))

    const unitInfoMap = new Map<
      string,
      {
        unitId: string
        unitLabel: string
        ratioToBase: number
        tiers: Array<{ minQty: number; unitPrice: number }>
      }
    >()
    if (unitKeys.length > 0) {
      const itemIdSet = Array.from(new Set(unitKeys.map((k) => k.itemId)))
      const unitIdSet = Array.from(new Set(unitKeys.map((k) => k.unitId)))
      const unitRows = await db
        .select({
          itemId: inventoryItemUnits.itemId,
          unitId: inventoryItemUnits.unitId,
          unitLabel: masterHppUnits.label,
          ratioToBase: inventoryItemUnits.ratioToBase,
        })
        .from(inventoryItemUnits)
        .innerJoin(
          masterHppUnits,
          eq(masterHppUnits.id, inventoryItemUnits.unitId),
        )
        .where(
          and(
            inArray(inventoryItemUnits.itemId, itemIdSet),
            inArray(inventoryItemUnits.unitId, unitIdSet),
          ),
        )

      const tierRows = await db
        .select({
          itemId: inventoryItemUnitPricing.itemId,
          unitId: inventoryItemUnitPricing.unitId,
          minQty: inventoryItemUnitPricing.minQty,
          unitPrice: inventoryItemUnitPricing.unitPrice,
        })
        .from(inventoryItemUnitPricing)
        .where(
          and(
            inArray(inventoryItemUnitPricing.itemId, itemIdSet),
            inArray(inventoryItemUnitPricing.unitId, unitIdSet),
          ),
        )
        .orderBy(inventoryItemUnitPricing.minQty)

      const tiersByKey = new Map<
        string,
        Array<{ minQty: number; unitPrice: number }>
      >()
      for (const t of tierRows) {
        const key = `${t.itemId}|${t.unitId}`
        const arr = tiersByKey.get(key) ?? []
        arr.push({ minQty: Number(t.minQty), unitPrice: Number(t.unitPrice) })
        tiersByKey.set(key, arr)
      }
      for (const u of unitRows) {
        const key = `${u.itemId}|${u.unitId}`
        unitInfoMap.set(key, {
          unitId: u.unitId,
          unitLabel: u.unitLabel,
          ratioToBase: Number(u.ratioToBase),
          tiers: tiersByKey.get(key) ?? [],
        })
      }
    }

    // Tier-gate line discount: only paid tiers with the
    // `line_discount` feature can submit per-line discounts.
    if (data.lines.some((l) => l.lineDiscount && l.lineDiscount.value > 0)) {
      assertPOSFeatureAvailable(auth.posTier, 'line_discount')
    }

    // Pre-fetch active auto-promos (JUR-9). Only fires for tenants on
    // tiers with `promo_codes` feature; non-Komplit tenants get an
    // empty list so the prepared loop just doesn't apply anything.
    // Date window filter happens in-memory (small set per tenant).
    const promoFeatureActive = posTierLimits(auth.posTier).features.includes(
      'promo_codes',
    )
    const nowForPromos = new Date()
    const activeAutoPromos = promoFeatureActive
      ? await db
          .select({
            id: tenantPromotions.id,
            triggerType: tenantPromotions.triggerType,
            discountType: tenantPromotions.discountType,
            discountValue: tenantPromotions.discountValue,
            maxDiscountAmount: tenantPromotions.maxDiscountAmount,
            minCartTotal: tenantPromotions.minCartTotal,
            startsAt: tenantPromotions.startsAt,
            endsAt: tenantPromotions.endsAt,
          })
          .from(tenantPromotions)
          .where(
            and(
              eq(tenantPromotions.tenantId, auth.tenantId),
              eq(tenantPromotions.isActive, true),
              isNull(tenantPromotions.code),
            ),
          )
      : []
    const inWindow = (p: { startsAt: Date | null; endsAt: Date | null }) =>
      (!p.startsAt || p.startsAt <= nowForPromos) &&
      (!p.endsAt || p.endsAt >= nowForPromos)
    type ActiveAutoPromo = (typeof activeAutoPromos)[number]
    // Keep only in-window auto promos; group their target rows by item
    // and category for per-line lookup. A single item / category can be
    // targeted by multiple promos — when that happens, the per-line
    // resolver picks the highest computed discount.
    const inWindowPromosById = new Map<string, ActiveAutoPromo>()
    for (const p of activeAutoPromos) {
      if (inWindow(p)) inWindowPromosById.set(p.id, p)
    }
    const autoPromosByItemId = new Map<string, ActiveAutoPromo[]>()
    const autoPromosByCategoryId = new Map<string, ActiveAutoPromo[]>()
    if (inWindowPromosById.size > 0) {
      const targets = await db
        .select({
          promotionId: promotionTargets.promotionId,
          itemId: promotionTargets.itemId,
          categoryId: promotionTargets.categoryId,
        })
        .from(promotionTargets)
        .where(
          inArray(
            promotionTargets.promotionId,
            Array.from(inWindowPromosById.keys()),
          ),
        )
      for (const t of targets) {
        const promo = inWindowPromosById.get(t.promotionId)
        if (!promo) continue
        if (t.itemId) {
          const bucket = autoPromosByItemId.get(t.itemId) ?? []
          bucket.push(promo)
          autoPromosByItemId.set(t.itemId, bucket)
        } else if (t.categoryId) {
          const bucket = autoPromosByCategoryId.get(t.categoryId) ?? []
          bucket.push(promo)
          autoPromosByCategoryId.set(t.categoryId, bucket)
        }
      }
    }
    /**
     * Per-line auto-promo resolver. Collects every candidate that
     * targets this item directly or its category, then picks the one
     * with the highest computed discount for the given base. Returns
     * null when no promo applies (or every candidate computes to 0).
     */
    function pickAutoPromoForLine(
      itemId: string,
      categoryId: string | null,
      base: number,
    ): { promo: ActiveAutoPromo; amount: number } | null {
      const candidates: ActiveAutoPromo[] = []
      const byItem = autoPromosByItemId.get(itemId)
      if (byItem) candidates.push(...byItem)
      if (categoryId) {
        const byCat = autoPromosByCategoryId.get(categoryId)
        if (byCat) candidates.push(...byCat)
      }
      if (candidates.length === 0) return null
      let best: { promo: ActiveAutoPromo; amount: number } | null = null
      for (const p of candidates) {
        const amount = computePromoAmount(p, base)
        if (!best || amount > best.amount) best = { promo: p, amount }
      }
      return best && best.amount > 0 ? best : null
    }

    // Validate each line + compute snapshots.
    interface PreparedLine {
      itemId: string | null
      variantId: string | null
      variantLabel: string | null
      nameSnapshot: string
      skuSnapshot: string | null
      soldUnitId: string | null
      soldUnitLabel: string | null
      qty: number
      qtyInBase: number | null
      unitPrice: number
      subtotal: number
      lineDiscountType: 'fixed' | 'percent' | null
      lineDiscountValue: number | null
      lineDiscountAmount: number
      autoPromoId: string | null
      autoPromoAmount: number
      hppAtSale: number | null
      isAdhoc: boolean
      isBulkPrice: boolean
    }
    /**
     * Compute the per-line discount amount, capped at the gross line
     * total so a line can't go negative. Mirrors the sale-level
     * discount math elsewhere in this file. Pre-tier-check call sites
     * pass undefined; this returns zeros for that path.
     */
    function computeLineDiscount(
      gross: number,
      input: { type: 'fixed' | 'percent'; value: number } | null | undefined,
    ): { type: 'fixed' | 'percent' | null; value: number | null; amount: number } {
      if (!input || input.value <= 0) {
        return { type: null, value: null, amount: 0 }
      }
      const amount =
        input.type === 'percent'
          ? Math.round((gross * input.value) / 100)
          : Math.min(input.value, gross)
      return { type: input.type, value: input.value, amount }
    }
    const prepared: PreparedLine[] = []
    let subtotal = 0
    for (const line of data.lines) {
      if (line.isAdhoc || !line.itemId) {
        if (!line.name || line.name.trim().length === 0) {
          throw new Error('Nama item ad-hoc wajib diisi')
        }
        const gross = line.qty * line.unitPrice
        const ld = computeLineDiscount(gross, line.lineDiscount)
        // Ad-hoc lines have no itemId so they can't match an
        // auto_product promo. Always 0 here.
        const sub = gross - ld.amount
        prepared.push({
          itemId: null,
          variantId: null,
          variantLabel: null,
          nameSnapshot: line.name,
          skuSnapshot: null,
          soldUnitId: null,
          soldUnitLabel: null,
          qty: line.qty,
          qtyInBase: null,
          unitPrice: line.unitPrice,
          subtotal: sub,
          lineDiscountType: ld.type,
          lineDiscountValue: ld.value,
          lineDiscountAmount: ld.amount,
          autoPromoId: null,
          autoPromoAmount: 0,
          hppAtSale: null,
          isAdhoc: true,
          isBulkPrice: false,
        })
        subtotal += sub
      } else {
        const item = itemMap.get(line.itemId)
        if (!item) throw new Error(`Item tidak ditemukan: ${line.itemId}`)
        if (item.hasVariants) {
          // Variant line — price + stock come from the chosen variant,
          // not the unit pricing tiers.
          if (!line.variantId)
            throw new Error(`Pilih variasi untuk "${item.name}"`)
          const variant = variantMap.get(line.variantId)
          if (!variant || variant.itemId !== item.id)
            throw new Error(`Variasi tidak valid untuk "${item.name}"`)
          const unitInfo = line.unitId
            ? unitInfoMap.get(`${line.itemId}|${line.unitId}`)
            : undefined
          const ratio = unitInfo?.ratioToBase ?? 1
          const hppPerBase = item.costPrice ? Number(item.costPrice) : null
          const gross = line.qty * variant.price
          const ld = computeLineDiscount(gross, line.lineDiscount)
          const bestAuto = pickAutoPromoForLine(
            item.id,
            item.categoryId,
            gross - ld.amount,
          )
          const autoPromoAmount = bestAuto?.amount ?? 0
          const sub = gross - ld.amount - autoPromoAmount
          prepared.push({
            itemId: item.id,
            variantId: variant.id,
            variantLabel: variant.label,
            nameSnapshot: item.name,
            skuSnapshot: variant.sku ?? item.sku ?? null,
            soldUnitId: line.unitId ?? item.baseUnitId,
            soldUnitLabel: unitInfo?.unitLabel ?? null,
            qty: line.qty,
            qtyInBase: line.qty * ratio,
            unitPrice: variant.price,
            subtotal: sub,
            lineDiscountType: ld.type,
            lineDiscountValue: ld.value,
            lineDiscountAmount: ld.amount,
            autoPromoId: bestAuto?.promo.id ?? null,
            autoPromoAmount,
            hppAtSale: hppPerBase != null ? hppPerBase * ratio : null,
            isAdhoc: false,
            isBulkPrice: false,
          })
          subtotal += sub
        } else {
        if (!line.unitId) {
          throw new Error(`Unit harus diisi untuk item "${item.name}"`)
        }
        const unitInfo = unitInfoMap.get(`${line.itemId}|${line.unitId}`)
        if (!unitInfo) {
          throw new Error(
            `Unit tidak terdaftar untuk item "${item.name}". Konfigurasi unit dulu di Inventory.`,
          )
        }
        // Tier lookup — pick the highest min_qty whose threshold is
        // ≤ this line's qty. If no tier, refuse: item is not sellable
        // at this unit yet (admin needs to add at least 1 tier).
        const matchedTier = unitInfo.tiers
          .filter((t) => line.qty >= t.minQty)
          .sort((a, b) => b.minQty - a.minQty)[0]
        if (!matchedTier) {
          throw new Error(
            `Belum ada harga untuk ${item.name} di unit ${unitInfo.unitLabel} pada qty ${line.qty}. Tambah tier di Inventory.`,
          )
        }
        const tierPrice = matchedTier.unitPrice
        const isBulk = matchedTier.minQty > 1

        // HPP snapshot: prefer the linked HPP product's hpp; else item
        // costPrice (per base unit). Stored per BASE unit so the cost
        // ledger stays apples-to-apples across alt-unit sales.
        const hppFromProduct = item.linkedHppProductId
          ? hppByProductId.get(item.linkedHppProductId)
          : undefined
        const hppPerBase =
          hppFromProduct ??
          (item.costPrice ? Number(item.costPrice) : null)
        // Per SOLD unit (for cost-of-this-line), informational only.
        const hppPerSoldUnit =
          hppPerBase != null ? hppPerBase * unitInfo.ratioToBase : null

        const gross = line.qty * tierPrice
        const ld = computeLineDiscount(gross, line.lineDiscount)
        // Auto-promo (JUR-9). Targets in `promotion_targets` reach
        // this line via item OR category — the resolver picks the
        // highest-discount candidate (consistent tie-break when more
        // than one promo matches). Applied AFTER the cashier-set line
        // discount, on the already-discounted base, so promos stack
        // multiplicatively with line discounts.
        const bestAuto = pickAutoPromoForLine(
          item.id,
          item.categoryId,
          gross - ld.amount,
        )
        const autoPromoAmount = bestAuto?.amount ?? 0
        const sub = gross - ld.amount - autoPromoAmount
        prepared.push({
          itemId: item.id,
          variantId: null,
          variantLabel: null,
          nameSnapshot: item.name,
          skuSnapshot: item.sku ?? null,
          soldUnitId: unitInfo.unitId,
          soldUnitLabel: unitInfo.unitLabel,
          qty: line.qty,
          qtyInBase: line.qty * unitInfo.ratioToBase,
          unitPrice: tierPrice,
          subtotal: sub,
          lineDiscountType: ld.type,
          lineDiscountValue: ld.value,
          lineDiscountAmount: ld.amount,
          autoPromoId: bestAuto?.promo.id ?? null,
          autoPromoAmount,
          hppAtSale: hppPerSoldUnit,
          isAdhoc: false,
          isBulkPrice: isBulk,
        })
        subtotal += sub
        }
      }
    }

    // Stock guard: refuse if any non-adhoc line — or the cumulative
    // qty across multiple lines of the same item — would exceed the
    // current balance at this branch. Hard server-side check so a
    // tampered client can't oversell. The cashier UI already blocks
    // this in the modal + cart stepper; this is defence-in-depth.
    {
      // Sum required base qty per item across all non-adhoc lines.
      // Service-mode items (linkedHppProductId) are skipped — they
      // have no own stock balance, the BOM walker handles ingredient
      // depletion downstream. Without this skip, ringing a recipe-
      // backed product like Teh Original would always reject with
      // "Stok 0, diminta N" because the parent never carries stock.
      const requiredByItem = new Map<string, number>()
      for (const p of prepared) {
        if (!p.itemId || p.qtyInBase == null) continue
        // Variant lines deduct per-variant stock — guarded separately.
        if (p.variantId) continue
        if (itemMap.get(p.itemId)?.linkedHppProductId) continue
        requiredByItem.set(
          p.itemId,
          (requiredByItem.get(p.itemId) ?? 0) + p.qtyInBase,
        )
      }
      if (requiredByItem.size > 0) {
        const balanceRows = await db
          .select({
            itemId: inventoryStockBalances.itemId,
            quantity: inventoryStockBalances.quantity,
          })
          .from(inventoryStockBalances)
          .where(
            and(
              inArray(
                inventoryStockBalances.itemId,
                Array.from(requiredByItem.keys()),
              ),
              eq(inventoryStockBalances.branchId, data.branchId),
            ),
          )
        const balanceByItem = new Map(
          balanceRows.map((b) => [b.itemId, Number(b.quantity)]),
        )
        for (const [itemId, required] of requiredByItem) {
          const available = balanceByItem.get(itemId) ?? 0
          if (required > available) {
            const item = itemMap.get(itemId)
            const name = item?.name ?? 'Item'
            throw new Error(
              `Stok ${name} tidak cukup. Tersedia ${available}, diminta ${required} (di unit dasar). Refresh kasir untuk lihat stok terbaru.`,
            )
          }
        }
      }

      // Variant stock guard — per-variant balance at this branch.
      const requiredByVariant = new Map<string, number>()
      for (const p of prepared) {
        if (!p.variantId || p.qtyInBase == null) continue
        requiredByVariant.set(
          p.variantId,
          (requiredByVariant.get(p.variantId) ?? 0) + p.qtyInBase,
        )
      }
      if (requiredByVariant.size > 0) {
        const vBalances = await db
          .select({
            variantId: inventoryItemVariantStock.variantId,
            quantity: inventoryItemVariantStock.quantity,
          })
          .from(inventoryItemVariantStock)
          .where(
            and(
              inArray(
                inventoryItemVariantStock.variantId,
                Array.from(requiredByVariant.keys()),
              ),
              eq(inventoryItemVariantStock.branchId, data.branchId),
            ),
          )
        const balByVariant = new Map(
          vBalances.map((b) => [b.variantId, Number(b.quantity)]),
        )
        for (const [variantId, required] of requiredByVariant) {
          const available = balByVariant.get(variantId) ?? 0
          if (required > available) {
            const label = variantMap.get(variantId)?.label ?? 'Variasi'
            throw new Error(
              `Stok ${label} tidak cukup. Tersedia ${available}, diminta ${required}. Refresh kasir untuk lihat stok terbaru.`,
            )
          }
        }
      }
    }

    // Pull tax + loyalty config from settings for the snapshot. We
    // gate loyalty BOTH on the tier feature flag (`loyalty_points` —
    // Komplit only) AND on the per-tenant `loyaltyEnabled` toggle so a
    // tenant can switch loyalty off without losing the bundle.
    const [settings] = await db
      .select({
        taxes: posSettings.taxes,
        loyaltyEnabled: posSettings.loyaltyEnabled,
        loyaltyEarnMode: posSettings.loyaltyEarnMode,
        loyaltyEarnRate: posSettings.loyaltyEarnRate,
        loyaltyEarnStepAmount: posSettings.loyaltyEarnStepAmount,
        loyaltyEarnStepPoints: posSettings.loyaltyEarnStepPoints,
        loyaltyRedeemRate: posSettings.loyaltyRedeemRate,
        adhocItemsEnabled: posSettings.adhocItemsEnabled,
      })
      .from(posSettings)
      .where(eq(posSettings.tenantId, auth.tenantId))
      .limit(1)

    // Anti-fraud gate: refuse ad-hoc lines when the tenant has the
    // "Item Lain" control switched off (default for tenants with no
    // settings row). The cashier already hides the button, but a stale
    // tab or a hand-crafted payload could still smuggle one in — this
    // is the authoritative check. Throws before any sale row is written.
    if (
      !(settings?.adhocItemsEnabled ?? false) &&
      prepared.some((l) => l.isAdhoc)
    ) {
      throw new Error('Fitur "Item Lain" tidak aktif untuk toko ini.')
    }
    // Resolve the active tax stack once so both the tax math + the
    // per-sale `tax_lines` snapshot read from the same shape.
    const activeTaxes = ((settings?.taxes ?? []) as Array<{
      label: string
      percent: number
      active: boolean
    }>)
      .filter((t) => t.active && t.percent > 0)
      .map((t) => ({ label: t.label, percent: Number(t.percent) }))

    let discountAmount = 0
    if (data.discount) {
      discountAmount =
        data.discount.type === 'percent'
          ? Math.round((subtotal * data.discount.value) / 100)
          : Math.min(data.discount.value, subtotal)
    }
    // Sale-level promo (JUR-9). Order: line discount + auto_product
    // already applied per-line above; here we apply the cart-level
    // marketing discount (data.discount), then a code/auto_cart promo.
    // Code wins over auto_cart if a code is provided — only one
    // sale-level promo can apply per sale.
    let salePromoBase = subtotal - discountAmount
    let resolvedCodePromo: {
      id: string
      code: string | null
      name: string
    } | null = null
    let resolvedAutoCartPromo: {
      id: string
      code: string | null
      name: string
    } | null = null
    let promoAmount = 0
    if (promoFeatureActive && data.promoCode && data.promoCode.trim()) {
      const code = data.promoCode.trim().toUpperCase()
      const [p] = await db
        .select()
        .from(tenantPromotions)
        .where(
          and(
            eq(tenantPromotions.tenantId, auth.tenantId),
            eq(tenantPromotions.code, code),
            eq(tenantPromotions.triggerType, 'code'),
            eq(tenantPromotions.isActive, true),
          ),
        )
        .limit(1)
      if (!p) throw new Error(`Kode promo "${code}" tidak ditemukan.`)
      // Re-run the same validations validatePromoCode does, inside
      // the sale path so caps + window are enforced under tx isolation.
      const now = new Date()
      if (p.startsAt && p.startsAt > now) {
        throw new Error(`Promo "${p.name}" belum dimulai.`)
      }
      if (p.endsAt && p.endsAt < now) {
        throw new Error(`Promo "${p.name}" sudah berakhir.`)
      }
      const minCart = p.minCartTotal ? Number(p.minCartTotal) : 0
      if (minCart > 0 && salePromoBase < minCart) {
        throw new Error(
          `Minimal belanja Rp ${minCart.toLocaleString('id-ID')} untuk pakai kode "${code}".`,
        )
      }
      if (p.totalRedemptionCap != null) {
        const [{ count } = { count: 0 }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(promoRedemptions)
          .where(eq(promoRedemptions.promoId, p.id))
        if (count >= p.totalRedemptionCap) {
          throw new Error(`Kuota promo "${code}" sudah habis.`)
        }
      }
      promoAmount = computePromoAmount(p, salePromoBase)
      resolvedCodePromo = { id: p.id, code: p.code, name: p.name }
    } else if (promoFeatureActive && activeAutoPromos.length > 0) {
      // Pick the auto_cart promo with the largest computed amount —
      // simple "best for the customer" tiebreaker. Re-window-checks
      // here for safety even though the pre-fetch already filtered.
      let bestAmount = 0
      let bestPromo: (typeof activeAutoPromos)[number] | null = null
      for (const p of activeAutoPromos) {
        if (p.triggerType !== 'auto_cart') continue
        if (!inWindow(p)) continue
        const minCart = p.minCartTotal ? Number(p.minCartTotal) : 0
        if (minCart > 0 && salePromoBase < minCart) continue
        const a = computePromoAmount(p, salePromoBase)
        if (a > bestAmount) {
          bestAmount = a
          bestPromo = p
        }
      }
      if (bestPromo) {
        promoAmount = bestAmount
        // listActivePromotions doesn't return the name (only the id);
        // pull it from the original query? Actually we do select id +
        // triggerType etc. but not name. Read it again — small cost.
        const [n] = await db
          .select({ id: tenantPromotions.id, name: tenantPromotions.name })
          .from(tenantPromotions)
          .where(eq(tenantPromotions.id, bestPromo.id))
          .limit(1)
        resolvedAutoCartPromo = {
          id: bestPromo.id,
          code: null,
          name: n?.name ?? 'Promo',
        }
      }
    }
    salePromoBase -= promoAmount

    const tierLimitsForLoyalty = posTierLimits(auth.posTier)
    const loyaltyTierActive =
      tierLimitsForLoyalty.features.includes('loyalty_points')
    const loyaltyActive =
      loyaltyTierActive && Boolean(settings?.loyaltyEnabled)
    // Redeem amount is computed AFTER discount so the cashier can stack
    // a marketing discount with a loyalty redemption. Capped to the
    // post-discount subtotal — the customer can't end up paying < 0
    // pre-tax. The `redeem_amount` lives separately from `discount_amount`
    // on pos_sales so reports can split "marketing cost" from "loyalty
    // burn-down" later.
    const requestedRedeemPoints = Math.max(0, Number(data.redeemPoints ?? 0))
    let loyaltyPointsRedeemed = 0
    let loyaltyRedeemAmount = 0
    if (loyaltyActive && requestedRedeemPoints > 0) {
      const redeemRate = Number(settings?.loyaltyRedeemRate ?? 0)
      // Redeem cap is the post-discount + post-promo subtotal so a
      // customer can't redeem points against money already promo'd off.
      const postDiscount = Math.max(0, salePromoBase)
      const cappedAmount = Math.min(
        requestedRedeemPoints * redeemRate,
        postDiscount,
      )
      // Normalise back to whole-point denomination so the ledger stays
      // aligned with how the cashier sees it ("you spent 1.250 points").
      loyaltyPointsRedeemed =
        redeemRate > 0 ? Math.floor(cappedAmount / redeemRate) : 0
      loyaltyRedeemAmount = loyaltyPointsRedeemed * redeemRate
    }
    const taxBase =
      subtotal - discountAmount - promoAmount - loyaltyRedeemAmount
    // Per-tax breakdown: each active tax row applies independently
    // to the same base. Sum lands as `taxAmount` (back-compat with
    // reports + receipt scalar field); the breakdown itself
    // snapshots into pos_sales.tax_lines so receipts can render
    // each line.
    const taxLineSnapshots = activeTaxes.map((t) => ({
      label: t.label,
      percent: t.percent,
      amount: Math.round((taxBase * t.percent) / 100),
    }))
    const taxAmount = taxLineSnapshots.reduce((sum, l) => sum + l.amount, 0)
    const total = taxBase + taxAmount
    // Earn against the post-redemption pre-tax base so a customer
    // can't double-dip (earn against what they redeemed). Mode
    // dispatches via computeLoyaltyEarn — linear keeps the legacy
    // floor(spend × rate) shape, per_step does
    // floor(spend / step_amount) × step_points so a tenant who set
    // "750 pt per Rp 15.000" gets 0 / 750 / 1500 / etc. depending
    // on spend.
    const loyaltyEarnMode =
      (settings?.loyaltyEarnMode as 'linear' | 'per_step' | undefined) ??
      'linear'
    const loyaltyEarnRate = Number(settings?.loyaltyEarnRate ?? 0)
    const loyaltyEarnStepAmount = Number(settings?.loyaltyEarnStepAmount ?? 0)
    const loyaltyEarnStepPoints = Number(settings?.loyaltyEarnStepPoints ?? 0)
    const loyaltyPointsEarned = loyaltyActive
      ? computeLoyaltyEarn(taxBase, {
          mode: loyaltyEarnMode,
          rate: loyaltyEarnRate,
          stepAmount: loyaltyEarnStepAmount,
          stepPoints: loyaltyEarnStepPoints,
        })
      : 0

    // JUR-195: stamp / punch-card programs. Gated on the same Komplit
    // `loyalty_points` feature; the per-tenant points toggle does NOT
    // gate stamps — having ≥1 active program is the implicit on switch.
    const stampPrograms = loyaltyTierActive
      ? await db
          .select({
            id: loyaltyStampPrograms.id,
            name: loyaltyStampPrograms.name,
            scope: loyaltyStampPrograms.scope,
            categoryId: loyaltyStampPrograms.categoryId,
            productId: loyaltyStampPrograms.productId,
            stampsRequired: loyaltyStampPrograms.stampsRequired,
            rewardMode: loyaltyStampPrograms.rewardMode,
            rewardItemId: loyaltyStampPrograms.rewardItemId,
          })
          .from(loyaltyStampPrograms)
          .where(
            and(
              eq(loyaltyStampPrograms.tenantId, auth.tenantId),
              eq(loyaltyStampPrograms.isActive, true),
            ),
          )
      : []
    const stampProgramById = new Map(stampPrograms.map((p) => [p.id, p]))
    const stampProgramByCategory = new Map(
      stampPrograms
        .filter((p) => p.scope === 'category' && p.categoryId !== null)
        .map((p) => [p.categoryId as string, p]),
    )
    const stampProgramByProduct = new Map(
      stampPrograms
        .filter((p) => p.scope === 'product' && p.productId !== null)
        .map((p) => [p.productId as string, p]),
    )

    // Multi-product (product_set) scope + bundle rewards both need
    // child-table lookups. Only fetch when there's at least one
    // program that needs them, otherwise we'd burn round trips on
    // the common single-scope case.
    const programIdsWithSet = stampPrograms
      .filter((p) => p.scope === 'product_set')
      .map((p) => p.id)
    const programIdsWithBundle = stampPrograms
      .filter((p) => p.rewardMode === 'bundle')
      .map((p) => p.id)

    const [scopeItemRows, bundleRewardRows] = await Promise.all([
      programIdsWithSet.length === 0
        ? Promise.resolve([])
        : db
            .select({
              programId: loyaltyStampProgramItems.programId,
              itemId: loyaltyStampProgramItems.itemId,
            })
            .from(loyaltyStampProgramItems)
            .where(
              inArray(loyaltyStampProgramItems.programId, programIdsWithSet),
            ),
      programIdsWithBundle.length === 0
        ? Promise.resolve([])
        : db
            .select({
              programId: loyaltyStampProgramRewards.programId,
              itemId: loyaltyStampProgramRewards.itemId,
              quantity: loyaltyStampProgramRewards.quantity,
            })
            .from(loyaltyStampProgramRewards)
            .where(
              inArray(
                loyaltyStampProgramRewards.programId,
                programIdsWithBundle,
              ),
            ),
    ])

    // itemId → program for product_set scope. If two product_set
    // programs claim the same item, last-write-wins; the editor
    // doesn't currently enforce uniqueness across product_set rows.
    const stampProgramByProductSetItem = new Map<
      string,
      (typeof stampPrograms)[number]
    >()
    const productSetItemsByProgram = new Map<string, string[]>()
    for (const r of scopeItemRows) {
      const program = stampProgramById.get(r.programId)
      if (!program) continue
      stampProgramByProductSetItem.set(r.itemId, program)
      const list = productSetItemsByProgram.get(r.programId) ?? []
      list.push(r.itemId)
      productSetItemsByProgram.set(r.programId, list)
    }

    // program → bundle reward shopping list.
    const bundleByProgram = new Map<
      string,
      Array<{ itemId: string; quantity: number }>
    >()
    for (const r of bundleRewardRows) {
      const list = bundleByProgram.get(r.programId) ?? []
      list.push({ itemId: r.itemId, quantity: r.quantity })
      bundleByProgram.set(r.programId, list)
    }

    // Match each requested redemption to free (Rp 0) cart lines that
    // were added as the program's reward. Single rewards consume ONE
    // line; bundle rewards consume ONE line per bundle item. Consumed
    // lines never earn a stamp.
    const requestedStampRedemptions = data.stampRedemptions ?? []
    if (requestedStampRedemptions.length > 0 && !loyaltyTierActive) {
      throw new Error('Fitur kartu stempel hanya tersedia di paket Komplit.')
    }
    const stampConsumedLineIdx = new Set<number>()
    const stampRedeemProgramIds: string[] = []
    for (const programId of requestedStampRedemptions) {
      const program = stampProgramById.get(programId)
      if (!program) {
        throw new Error('Program stempel tidak ditemukan atau tidak aktif.')
      }

      if (program.rewardMode === 'bundle') {
        const bundle = bundleByProgram.get(program.id) ?? []
        if (bundle.length === 0) {
          throw new Error(
            `Bundle hadiah "${program.name}" belum dikonfigurasi.`,
          )
        }
        // Greedy match: claim one free cart line per bundle item.
        // Items may appear in any cart order; we mark each picked
        // index in stampConsumedLineIdx so it can't be double-claimed.
        const claimedThisRedemption = new Set<number>()
        for (const reward of bundle) {
          const idx = prepared.findIndex(
            (l, i) =>
              !stampConsumedLineIdx.has(i) &&
              !claimedThisRedemption.has(i) &&
              l.itemId === reward.itemId &&
              l.subtotal === 0,
          )
          if (idx === -1) {
            throw new Error(
              `Bundle "${program.name}" belum lengkap — tambahkan semua item bundle sebagai baris gratis.`,
            )
          }
          claimedThisRedemption.add(idx)
        }
        for (const i of claimedThisRedemption) stampConsumedLineIdx.add(i)
      } else {
        // Single reward (existing flow).
        const idx = prepared.findIndex(
          (l, i) =>
            !stampConsumedLineIdx.has(i) &&
            l.itemId === program.rewardItemId &&
            l.subtotal === 0,
        )
        if (idx === -1) {
          throw new Error(
            `Tambahkan "${program.name}" sebagai item gratis di keranjang untuk menukar stempel.`,
          )
        }
        stampConsumedLineIdx.add(idx)
      }
      stampRedeemProgramIds.push(programId)
    }

    // Stamp earn: one stamp per qualifying unit sold (floor of qty).
    // The free reward line(s) consumed above never earn a stamp.
    //
    // Most-specific-wins precedence:
    //   1. single-product program (exact item match)
    //   2. product_set program (item in the set)
    //   3. category program (item's category matches)
    // This prevents one line from earning multiple stamps when scopes
    // overlap (e.g. a Motor category program + a Cuci Motor product
    // program; the product wins).
    const stampEarnByProgram = new Map<string, number>()
    if (stampPrograms.length > 0) {
      prepared.forEach((line, i) => {
        if (stampConsumedLineIdx.has(i) || !line.itemId) return
        const program =
          stampProgramByProduct.get(line.itemId) ??
          stampProgramByProductSetItem.get(line.itemId) ??
          (() => {
            const categoryId = itemMap.get(line.itemId!)?.categoryId
            return categoryId ? stampProgramByCategory.get(categoryId) : null
          })()
        if (!program) return
        const stamps = Math.floor(line.qty)
        if (stamps <= 0) return
        stampEarnByProgram.set(
          program.id,
          (stampEarnByProgram.get(program.id) ?? 0) + stamps,
        )
      })
    }

    if (data.paidAmount < total && !wantsKasbon) {
      throw new Error(
        `Pembayaran kurang. Total ${total.toLocaleString('id-ID')}, dibayar ${data.paidAmount.toLocaleString('id-ID')}.`,
      )
    }
    const changeAmount =
      data.paymentMethod === 'cash'
        ? Math.max(0, data.paidAmount - total)
        : 0

    const now = new Date()
    const result = await db.transaction(async (tx) => {
      const saleNumber = await nextSaleNumber(tx as any, auth.tenantId, now)

      // Customer DB attach (JUR-6, Toko+ feature). When a phone is
      // provided AND the tier has `customer_db`, upsert into the
      // customers table and link the sale via customer_id. Aggregates
      // (total_spent, visit_count, last_visit_at) are bumped here
      // inside the same tx so reads stay consistent.
      let customerId: string | null = null
      const tierLimits = posTierLimits(auth.posTier)
      const customerDbActive = tierLimits.features.includes('customer_db')
      const loyaltyActiveInTx = loyaltyActive
      // Customer-id-bearing requirement for loyalty: redemption needs a
      // ledgered balance to draw from, and earn writes a movement keyed
      // by customer_id. If the cashier didn't attach a customer (no
      // phone or customer_db gate failed), loyalty is silently dropped.
      const normalisedPhone = customerDbActive
        ? normalizePhone(data.customerPhone ?? null)
        : null
      if (
        customerDbActive &&
        normalisedPhone &&
        data.customerName?.trim()
      ) {
        const [upserted] = await tx
          .insert(customers)
          .values({
            tenantId: auth.tenantId,
            name: data.customerName.trim(),
            phone: normalisedPhone,
            totalSpent: total.toString(),
            visitCount: 1,
            lastVisitAt: now,
          })
          .onConflictDoUpdate({
            target: [customers.tenantId, customers.phone],
            // Required because customers_tenant_phone_unique is a
            // PARTIAL index (WHERE phone IS NOT NULL) — see customers.ts
            // upsertCustomer for the full rationale.
            targetWhere: sql`${customers.phone} IS NOT NULL`,
            set: {
              name: data.customerName.trim(),
              // Aggregate updates use raw SQL so we add to the
              // existing value rather than overwriting it.
              totalSpent: sql`${customers.totalSpent} + ${total}`,
              visitCount: sql`${customers.visitCount} + 1`,
              lastVisitAt: now,
              updatedAt: now,
            },
          })
          .returning({ id: customers.id })
        customerId = upserted?.id ?? null
      }

      // Loyalty redemption: we must validate balance + insert the
      // redeem ledger row inside the transaction so a concurrent sale
      // can't double-spend the same points. If the cashier didn't
      // attach a customer, drop redeem silently — same flow as
      // customer-db requirement above.
      let effectivePointsRedeemed = 0
      let effectiveRedeemAmount = 0
      // taxBase in the cold path already factors out discount + promo;
      // we re-thread it through effectiveTaxBase below when loyalty
      // redeem actually fires under the tx.
      let effectiveTaxBase = subtotal - discountAmount - promoAmount
      let effectiveTaxAmount = taxAmount
      let effectiveTaxLines = taxLineSnapshots
      let effectiveTotal = total
      let effectiveChangeAmount = changeAmount
      let priorBalance = 0
      if (loyaltyActiveInTx && customerId && loyaltyPointsRedeemed > 0) {
        const [bal] = await tx
          .select({
            id: customerLoyaltyBalances.id,
            balance: customerLoyaltyBalances.pointsBalance,
          })
          .from(customerLoyaltyBalances)
          .where(eq(customerLoyaltyBalances.customerId, customerId))
          .limit(1)
        priorBalance = Number(bal?.balance ?? 0)
        if (loyaltyPointsRedeemed > priorBalance) {
          throw new Error(
            `Saldo poin tidak cukup. Saldo: ${priorBalance.toLocaleString('id-ID')}, diminta: ${loyaltyPointsRedeemed.toLocaleString('id-ID')}.`,
          )
        }
        effectivePointsRedeemed = loyaltyPointsRedeemed
        effectiveRedeemAmount = loyaltyRedeemAmount
        // Re-derive the totals using the validated (possibly capped)
        // redemption. We computed these outside the tx assuming the
        // balance is sufficient; if it wasn't we'd have thrown above,
        // so the values agree — but keep this branch explicit so a
        // future tweak (e.g. partial redeem on insufficient balance)
        // doesn't silently desync.
        effectiveTaxBase =
          subtotal - discountAmount - promoAmount - effectiveRedeemAmount
        effectiveTaxLines = activeTaxes.map((t) => ({
          label: t.label,
          percent: t.percent,
          amount: Math.round((effectiveTaxBase * t.percent) / 100),
        }))
        effectiveTaxAmount = effectiveTaxLines.reduce(
          (sum, l) => sum + l.amount,
          0,
        )
        effectiveTotal = effectiveTaxBase + effectiveTaxAmount
        if (data.paidAmount < effectiveTotal && !wantsKasbon) {
          throw new Error(
            `Pembayaran kurang. Total ${effectiveTotal.toLocaleString('id-ID')}, dibayar ${data.paidAmount.toLocaleString('id-ID')}.`,
          )
        }
        effectiveChangeAmount =
          data.paymentMethod === 'cash'
            ? Math.max(0, data.paidAmount - effectiveTotal)
            : 0
      }
      // Earn count uses the effective tax base (post-redemption,
      // pre-tax) so the customer doesn't earn on points they just
      // burned down. Same mode dispatch as the cold path above.
      const effectivePointsEarned =
        loyaltyActiveInTx && customerId
          ? computeLoyaltyEarn(effectiveTaxBase, {
              mode: loyaltyEarnMode,
              rate: loyaltyEarnRate,
              stepAmount: loyaltyEarnStepAmount,
              stepPoints: loyaltyEarnStepPoints,
            })
          : 0

      const [sale] = await tx
        .insert(posSales)
        .values({
          tenantId: auth.tenantId,
          branchId: data.branchId,
          saleNumber,
          cashierUserId: auth.userId,
          customerId,
          customerName: data.customerName ?? null,
          customerPhone: data.customerPhone ?? null,
          subtotal: subtotal.toString(),
          discountType: data.discount?.type ?? null,
          discountValue:
            data.discount?.value != null ? data.discount.value.toString() : null,
          discountAmount: discountAmount.toString(),
          taxAmount: effectiveTaxAmount.toString(),
          // Per-tax breakdown — receipts + future per-tax reports read
          // from this. Empty array snapshotted instead of null when no
          // taxes are active so downstream consumers can rely on a
          // consistent shape.
          taxLines: effectiveTaxLines,
          total: effectiveTotal.toString(),
          paymentMethod: data.paymentMethod,
          paidAmount: data.paidAmount.toString(),
          changeAmount: effectiveChangeAmount.toString(),
          status: 'completed',
          loyaltyPointsEarned:
            loyaltyActiveInTx && customerId
              ? effectivePointsEarned.toString()
              : null,
          loyaltyPointsRedeemed:
            loyaltyActiveInTx && customerId
              ? effectivePointsRedeemed.toString()
              : null,
          loyaltyRedeemAmount:
            loyaltyActiveInTx && customerId
              ? effectiveRedeemAmount.toString()
              : null,
          // Promo snapshot (JUR-9). Code uses the typed code; auto_cart
          // uses the promo's name (no code to display). Auto_product
          // promos are per-line and stored on pos_sale_items.
          promoCodeSnapshot:
            resolvedCodePromo?.code ?? resolvedAutoCartPromo?.name ?? null,
          promoAmount: promoAmount > 0 ? promoAmount.toString() : null,
          notes: data.notes ?? null,
        })
        .returning()

      // Promo ledger writes (JUR-9). One row per applied promo:
      //   - sale-level (code + auto_cart) → one row keyed off the
      //     resolved promo id, amount = sale-level promoAmount
      //   - per-line (auto_product) → one row per discounted line,
      //     amount = autoPromoAmount on that line
      // The total/per-customer caps are enforced upstream; this is
      // the audit trail.
      const salePromoIdResolved =
        resolvedCodePromo?.id ?? resolvedAutoCartPromo?.id ?? null
      if (salePromoIdResolved && promoAmount > 0) {
        await tx.insert(promoRedemptions).values({
          tenantId: auth.tenantId,
          promoId: salePromoIdResolved,
          saleId: sale!.id,
          customerId: customerId ?? null,
          amount: promoAmount.toString(),
        })
      }
      for (const line of prepared) {
        if (line.autoPromoId && line.autoPromoAmount > 0) {
          await tx.insert(promoRedemptions).values({
            tenantId: auth.tenantId,
            promoId: line.autoPromoId,
            saleId: sale!.id,
            customerId: customerId ?? null,
            amount: line.autoPromoAmount.toString(),
          })
        }
      }

      // Loyalty ledger writes (JUR-8). Both branches gated on a
      // resolved customerId — anonymous walk-ins can't earn or
      // redeem. Movements are positive in the ledger; the `type`
      // decides direction.
      if (loyaltyActiveInTx && customerId) {
        if (effectivePointsRedeemed > 0) {
          await tx.insert(customerLoyaltyMovements).values({
            tenantId: auth.tenantId,
            customerId,
            type: 'redeem',
            points: effectivePointsRedeemed.toString(),
            saleId: sale!.id,
            reason: `Tukar poin di transaksi ${saleNumber}`,
          })
        }
        if (effectivePointsEarned > 0) {
          await tx.insert(customerLoyaltyMovements).values({
            tenantId: auth.tenantId,
            customerId,
            type: 'earn',
            points: effectivePointsEarned.toString(),
            saleId: sale!.id,
            reason: `Poin dari transaksi ${saleNumber}`,
          })
        }
        if (effectivePointsRedeemed > 0 || effectivePointsEarned > 0) {
          // Upsert the running balance. INSERT path covers the very
          // first earn/redeem for a brand-new customer; UPDATE path
          // bumps the existing aggregate. We compute net delta in SQL
          // so concurrent sales (different transactions) don't race.
          await tx
            .insert(customerLoyaltyBalances)
            .values({
              tenantId: auth.tenantId,
              customerId,
              pointsBalance: (
                effectivePointsEarned - effectivePointsRedeemed
              ).toString(),
              lifetimeEarned: effectivePointsEarned.toString(),
              lifetimeRedeemed: effectivePointsRedeemed.toString(),
            })
            .onConflictDoUpdate({
              target: customerLoyaltyBalances.customerId,
              set: {
                pointsBalance: sql`${customerLoyaltyBalances.pointsBalance} + ${effectivePointsEarned - effectivePointsRedeemed}`,
                lifetimeEarned: sql`${customerLoyaltyBalances.lifetimeEarned} + ${effectivePointsEarned}`,
                lifetimeRedeemed: sql`${customerLoyaltyBalances.lifetimeRedeemed} + ${effectivePointsRedeemed}`,
                updatedAt: now,
              },
            })
        }
      }

      // JUR-195: stamp card earn + redeem. Both require an attached
      // customer — a redemption without one fails loudly (the cashier
      // already zeroed the reward line, so silently dropping it would
      // give away a free wash). Earn without a customer is dropped
      // silently, same as the points path.
      if (loyaltyTierActive && customerId) {
        const touchedPrograms = new Set<string>([
          ...stampEarnByProgram.keys(),
          ...stampRedeemProgramIds,
        ])
        for (const programId of touchedPrograms) {
          const program = stampProgramById.get(programId)!
          const earn = stampEarnByProgram.get(programId) ?? 0
          const redeemCount = stampRedeemProgramIds.filter(
            (id) => id === programId,
          ).length

          const [card] = await tx
            .select()
            .from(customerStampCards)
            .where(
              and(
                eq(customerStampCards.customerId, customerId),
                eq(customerStampCards.programId, programId),
              ),
            )
            .limit(1)

          // Earn lands first, then the redemption draws from the
          // resulting balance — so a card completed by this very sale
          // can still be redeemed in the same transaction.
          const afterEarn = (card?.currentStamps ?? 0) + earn
          const required = program.stampsRequired * redeemCount
          if (afterEarn < required) {
            throw new Error(
              `Stempel "${program.name}" tidak cukup untuk tukar gratis.`,
            )
          }
          const finalStamps = afterEarn - required

          let cardId: string
          if (card) {
            cardId = card.id
            await tx
              .update(customerStampCards)
              .set({
                currentStamps: finalStamps,
                lifetimeStamps: card.lifetimeStamps + earn,
                lifetimeRewards: card.lifetimeRewards + redeemCount,
                updatedAt: now,
              })
              .where(eq(customerStampCards.id, card.id))
          } else {
            const [inserted] = await tx
              .insert(customerStampCards)
              .values({
                tenantId: auth.tenantId,
                customerId,
                programId,
                currentStamps: finalStamps,
                lifetimeStamps: earn,
                lifetimeRewards: redeemCount,
              })
              .returning({ id: customerStampCards.id })
            cardId = inserted!.id
          }

          if (earn > 0) {
            await tx.insert(customerStampMovements).values({
              tenantId: auth.tenantId,
              cardId,
              type: 'earn',
              stamps: earn,
              saleId: sale!.id,
              reason: `Stempel dari transaksi ${saleNumber}`,
            })
          }
          for (let r = 0; r < redeemCount; r++) {
            await tx.insert(customerStampMovements).values({
              tenantId: auth.tenantId,
              cardId,
              type: 'redeem',
              stamps: program.stampsRequired,
              saleId: sale!.id,
              reason: `Tukar gratis di transaksi ${saleNumber}`,
            })
          }
        }
      } else if (stampRedeemProgramIds.length > 0) {
        throw new Error(
          'Tukar stempel butuh pelanggan terdaftar. Isi nama + nomor HP pelanggan dulu.',
        )
      }

      // Insert lines + per-line stock movements (only for non-adhoc).
      for (const line of prepared) {
        await tx.insert(posSaleItems).values({
          tenantId: auth.tenantId,
          saleId: sale!.id,
          itemId: line.itemId,
          variantId: line.variantId,
          variantLabel: line.variantLabel,
          nameSnapshot: line.nameSnapshot,
          skuSnapshot: line.skuSnapshot,
          // qty is in the SOLD unit; qtyInBase carries the base-unit
          // equivalent that the inventory ledger needs.
          qty: line.qty.toString(),
          soldUnitId: line.soldUnitId,
          soldUnitLabel: line.soldUnitLabel,
          qtyInBase:
            line.qtyInBase != null ? line.qtyInBase.toString() : null,
          unitPrice: line.unitPrice.toString(),
          subtotal: line.subtotal.toString(),
          // Line-discount snapshot (JUR-7). Stored alongside subtotal
          // so receipts + reports can render "(diskon Rp X)" without
          // re-deriving from value+type.
          lineDiscountType: line.lineDiscountType,
          lineDiscountValue:
            line.lineDiscountValue != null
              ? line.lineDiscountValue.toString()
              : null,
          lineDiscountAmount: line.lineDiscountAmount.toString(),
          // Auto-promo snapshot (JUR-9). Distinct from line_discount_*
          // so reports can split owner-set promos from cashier-applied
          // discounts later.
          autoPromoId: line.autoPromoId,
          autoPromoAmount: line.autoPromoAmount.toString(),
          hppAtSale: line.hppAtSale != null ? line.hppAtSale.toString() : null,
          isAdhoc: line.isAdhoc,
          isBulkPrice: line.isBulkPrice,
        })

        if (!line.itemId) continue
        const baseQty = line.qtyInBase ?? line.qty

        // Variant line — deduct the chosen variant's stock instead of the
        // item-level balance.
        if (line.variantId) {
          await tx.insert(inventoryMovements).values({
            tenantId: auth.tenantId,
            itemId: line.itemId,
            variantId: line.variantId,
            branchId: data.branchId,
            movementType: 'out',
            quantity: baseQty.toString(),
            unitCost: line.hppAtSale != null ? line.hppAtSale.toString() : null,
            reason: 'pos_sale',
            referenceType: 'pos_sale',
            referenceId: sale!.id,
            notes: `Penjualan ${saleNumber}${line.variantLabel ? ` (${line.variantLabel})` : ''}`,
            performedBy: auth.userId,
          })
          const [existingV] = await tx
            .select({
              id: inventoryItemVariantStock.id,
              quantity: inventoryItemVariantStock.quantity,
            })
            .from(inventoryItemVariantStock)
            .where(
              and(
                eq(inventoryItemVariantStock.variantId, line.variantId),
                eq(inventoryItemVariantStock.branchId, data.branchId),
              ),
            )
            .limit(1)
          if (existingV) {
            await tx
              .update(inventoryItemVariantStock)
              .set({
                quantity: (Number(existingV.quantity) - baseQty).toString(),
                lastMovementAt: now,
                updatedAt: now,
              })
              .where(eq(inventoryItemVariantStock.id, existingV.id))
          } else {
            await tx.insert(inventoryItemVariantStock).values({
              tenantId: auth.tenantId,
              variantId: line.variantId,
              branchId: data.branchId,
              quantity: (-baseQty).toString(),
              lastMovementAt: now,
            })
          }
          continue
        }

        // Service-mode: a recipe-backed inventory item (linkedHppProductId
        // set) is "made-to-order" — it doesn't carry its own stock. The
        // BOM walker below deducts ingredients; we MUST skip the
        // item-level out movement here, otherwise sales push the recipe
        // item's balance negative even though stock was never tracked.
        // The cashier grid surfaces these as "Auto" instead of "Stok: N".
        const recipeBacked = Boolean(itemMap.get(line.itemId)?.linkedHppProductId)
        if (recipeBacked) continue

        // Inline movement insert + balance upsert. We don't call
        // `recordMovement` because the inventory module's tier checks
        // would block a Free POS-on-Toko-inventory tenant; movement
        // creation here is a downstream side-effect, not user-initiated
        // inventory action. Stock ledger always uses base units.
        await tx.insert(inventoryMovements).values({
          tenantId: auth.tenantId,
          itemId: line.itemId,
          branchId: data.branchId,
          movementType: 'out',
          quantity: baseQty.toString(),
          unitCost: line.hppAtSale != null ? line.hppAtSale.toString() : null,
          reason: 'pos_sale',
          referenceType: 'pos_sale',
          referenceId: sale!.id,
          notes: `Penjualan ${saleNumber}`,
          performedBy: auth.userId,
        })

        const [existing] = await tx
          .select({ id: inventoryStockBalances.id, quantity: inventoryStockBalances.quantity })
          .from(inventoryStockBalances)
          .where(
            and(
              eq(inventoryStockBalances.itemId, line.itemId),
              eq(inventoryStockBalances.branchId, data.branchId),
            ),
          )
          .limit(1)
        if (existing) {
          const newQty = Number(existing.quantity) - baseQty
          await tx
            .update(inventoryStockBalances)
            .set({
              quantity: newQty.toString(),
              lastMovementAt: now,
              updatedAt: now,
            })
            .where(eq(inventoryStockBalances.id, existing.id))
        } else {
          // No balance row yet → start at -baseQty. Inventory UI shows
          // this as "Stok kurang" so the owner knows to do a stock-in.
          await tx.insert(inventoryStockBalances).values({
            tenantId: auth.tenantId,
            itemId: line.itemId,
            branchId: data.branchId,
            quantity: (-baseQty).toString(),
            lastMovementAt: now,
          })
        }
      }

      // Ingredient auto-deduction (JUR-10) — Toko+ feature gated on
      // `ingredient_consumption`. For each non-adhoc line whose linked
      // inventory item has a recipe (linkedHppProductId), walk the BOM
      // and deduct each material's stock. Free-tier sales that contain
      // a recipe-backed product fall through with `recipeNudge=true`
      // so the cashier can show the "Auto-deduct tersedia di paket
      // Toko" soft nudge once per session.
      const ingredientFeatureActive = posTierLimits(auth.posTier).features.includes(
        'ingredient_consumption',
      )
      // Track recipe-backed lines for the soft nudge (regardless of tier).
      const recipeBackedLines = prepared
        .map((line, idx) => ({ line, prepared: line, index: idx }))
        .filter(({ line }) => {
          if (!line.itemId || line.isAdhoc) return false
          const item = itemMap.get(line.itemId)
          return Boolean(item?.linkedHppProductId)
        })
      const recipeBackedSold = recipeBackedLines.length > 0

      // Trackers for unlinked-material + unscalable-sub-recipe
      // notifications. Both are productId/materialId → name maps so the
      // notification body can name the offender without a second query.
      const unlinkedMaterials = new Map<string, string>()
      const unscalableSubRecipes = new Map<string, string>()

      if (ingredientFeatureActive && recipeBackedSold) {
        for (const { line } of recipeBackedLines) {
          const item = itemMap.get(line.itemId!)!
          // Parent qty in the parent's BASE unit. The BOM's per-unit
          // quantities are implicitly per-base-unit, so this is the
          // multiplier for every material in the recipe.
          const parentBaseQty = line.qtyInBase ?? line.qty

          // JUR-15 branch: prep_mode=true means the BOM's bulk-prep
          // materials were already deducted at "Prep batch" time. The
          // sale FIFO-consumes the open ledger rows AND deducts any
          // add-at-counter materials (add_at='finish'). If the open
          // counter is < line qty, consumePrepBatchesForLine throws
          // and rolls the whole sale back (hard-block at Siap=0).
          if (item.prepMode) {
            await consumePrepBatchesForLine({
              tx: tx as unknown as typeof db,
              tenantId: auth.tenantId,
              itemId: item.id,
              itemName: item.name,
              branchId: data.branchId,
              qtyInBase: parentBaseQty,
              now,
            })
            // JUR-15 v2: also deduct the BOM rows marked add_at='finish'
            // — these are the per-cup additions (gula/susu/sirup) that
            // were intentionally skipped during prep batch. Recipes
            // without any 'finish' rows do nothing here (the helper
            // exits early on empty filter).
            await deductBomIngredients({
              tx: tx as unknown as typeof db,
              tenantId: auth.tenantId,
              userId: auth.userId,
              branchId: data.branchId,
              parentLinkedHppProductId: item.linkedHppProductId!,
              parentBaseQty,
              reason: 'pos_sale_ingredient',
              referenceType: 'pos_sale',
              referenceId: sale!.id,
              notesPrefix: `${saleNumber} (finish)`,
              phase: 'finish',
              unlinkedMaterials,
              unscalableSubRecipes,
              now,
            })
            continue
          }

          await deductBomIngredients({
            tx: tx as unknown as typeof db,
            tenantId: auth.tenantId,
            userId: auth.userId,
            branchId: data.branchId,
            parentLinkedHppProductId: item.linkedHppProductId!,
            parentBaseQty,
            reason: 'pos_sale_ingredient',
            referenceType: 'pos_sale',
            referenceId: sale!.id,
            notesPrefix: saleNumber,
            unlinkedMaterials,
            unscalableSubRecipes,
            now,
          })
        }
      }

      // One-time-per-(tenant, material) notification for unlinked
      // ingredients. Uses the partial unique index on (user_id, type,
      // source_key) for idempotency — see notifications schema. The
      // owner is the recipient: we look them up via tenants.ownerId.
      if (unlinkedMaterials.size > 0) {
        const [tenantOwner] = await tx
          .select({ ownerId: sql<string>`owner_id` })
          .from(sql`tenants`)
          .where(sql`id = ${auth.tenantId}`)
          .limit(1)
        if (tenantOwner?.ownerId) {
          for (const [materialId, materialName] of unlinkedMaterials) {
            await tx
              .insert(notifications)
              .values({
                userId: tenantOwner.ownerId,
                tenantId: auth.tenantId,
                type: 'pos_unlinked_material',
                title: 'Bahan resep belum terhubung ke inventaris',
                body: `Bahan "${materialName}" dipakai di resep tapi belum punya item inventaris. Stok bahan ini tidak terhitung otomatis sampai dihubungkan.`,
                url: `/inventory/items?linkHpp=${materialId}`,
                sourceKey: `pos_unlinked_material:${materialId}`,
              })
              .onConflictDoNothing()
          }
        }
      }

      // One-time-per-(tenant, sub-product) notification for sub-recipes
      // that couldn't be auto-deducted — no production qty set, a
      // recipe unit that doesn't match the production unit, or a
      // recursion cycle. Scalable sub-recipes ARE deducted recursively
      // and never reach here.
      if (unscalableSubRecipes.size > 0) {
        const [tenantOwner] = await tx
          .select({ ownerId: sql<string>`owner_id` })
          .from(sql`tenants`)
          .where(sql`id = ${auth.tenantId}`)
          .limit(1)
        if (tenantOwner?.ownerId) {
          for (const [productId, productName] of unscalableSubRecipes) {
            await tx
              .insert(notifications)
              .values({
                userId: tenantOwner.ownerId,
                tenantId: auth.tenantId,
                type: 'pos_nested_recipe_skipped',
                title: 'Sub-resep belum bisa auto-deduct',
                body: `Sub-resep "${productName}" belum punya jumlah produksi yang cocok, jadi bahannya tidak dikurangi otomatis. Atur jumlah produksi resep ini di menu HPP agar stok bahannya ikut terhitung.`,
                url: '/hpp',
                sourceKey: `pos_nested_recipe_skipped:${productId}`,
              })
              .onConflictDoNothing()
          }
        }
      }

      // JUR-191 kasbon split. `kasbonGap` = the cart amount the
      // customer didn't pay now (becomes a receivable); `paidForSale`
      // = what they actually paid toward this cart.
      const kasbonGap = wantsKasbon
        ? Math.max(0, effectiveTotal - data.paidAmount)
        : 0
      const paidForSale = effectiveTotal - kasbonGap

      // JUR-141 Peti Kas: a cash sale auto-inserts a ledger movement
      // into the cashier's open session. Skipped when paymentMethod
      // isn't cash, or when cash drawer is disabled (cashSessionId
      // resolved to null at the top of the handler in that case).
      // Net cash into the till = what was paid for this cart +
      // any kasbon cash the customer handed over.
      if (cashSessionId) {
        await insertCashMovement(tx as unknown as typeof db, {
          tenantId: auth.tenantId,
          sessionId: cashSessionId,
          type: 'sale',
          amount: paidForSale + kasbonPaymentAmount,
          referenceSaleId: sale!.id,
          createdByUserId: auth.userId,
        })
      }

      // JUR-156 / JUR-191: mirror the sale into the cashflow ledger.
      // Income is recognised on cash actually collected for this cart
      // (`paidForSale`) — the kasbon gap is recorded as a receivable,
      // not income. A kasbon pay-down posts its own ar_payment rows.
      if (posTierLimits(auth.posTier).features.includes('cashflow')) {
        if (paidForSale > 0) {
          await writePosSaleCashflowEntry(tx as unknown as typeof db, {
            tenantId: auth.tenantId,
            saleId: sale!.id,
            branchId: data.branchId,
            amount: paidForSale,
            occurredAt: now,
            createdByUserId: auth.userId,
          })
        }
        if (kasbonGap > 0) {
          if (!customerId) {
            throw new Error('Gagal mengaitkan pelanggan untuk kasbon.')
          }
          await createSaleReceivable(tx as unknown as typeof db, {
            tenantId: auth.tenantId,
            customerId,
            saleId: sale!.id,
            amount: kasbonGap,
          })
        }
        if (kasbonPaymentAmount > 0) {
          if (!customerId) {
            throw new Error('Gagal mengaitkan pelanggan untuk kasbon.')
          }
          await applyKasbonPaymentFifo(tx as unknown as typeof db, {
            tenantId: auth.tenantId,
            customerId,
            amount: kasbonPaymentAmount,
            method: mapPosMethodToArMethod(data.paymentMethod),
            userId: auth.userId,
            now,
          })
        }
      }

      return {
        saleId: sale!.id,
        saleNumber,
        /** Soft nudge flag — true when this sale rang a recipe-backed
         *  product on a tier without ingredient_consumption (i.e. Free).
         *  Cashier client shows the "Upgrade ke Toko untuk auto-deduct"
         *  toast once per session. */
        recipeNudge: recipeBackedSold && !ingredientFeatureActive,
        // Loyalty echo for the success modal + receipt rendering. The
        // cashier UI uses these to show "Pelanggan dapat 33 poin" and
        // print the new balance on the receipt footer.
        loyalty:
          loyaltyActiveInTx && customerId
            ? {
                priorBalance,
                pointsRedeemed: effectivePointsRedeemed,
                redeemAmount: effectiveRedeemAmount,
                pointsEarned: effectivePointsEarned,
                newBalance:
                  priorBalance -
                  effectivePointsRedeemed +
                  effectivePointsEarned,
              }
            : null,
        // JUR-191: kasbon echo for the cashier success toast.
        kasbonCreated: kasbonGap,
        kasbonPaid: kasbonPaymentAmount,
      }
    })

    return result
  })

// ─── Sale detail + receipt ───────────────────────────────────────────

export const getSale = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    const [sale] = await db
      .select({
        id: posSales.id,
        saleNumber: posSales.saleNumber,
        branchId: posSales.branchId,
        branchName: branches.name,
        cashierUserId: posSales.cashierUserId,
        customerName: posSales.customerName,
        customerPhone: posSales.customerPhone,
        subtotal: posSales.subtotal,
        discountType: posSales.discountType,
        discountValue: posSales.discountValue,
        discountAmount: posSales.discountAmount,
        taxAmount: posSales.taxAmount,
        total: posSales.total,
        paymentMethod: posSales.paymentMethod,
        paidAmount: posSales.paidAmount,
        changeAmount: posSales.changeAmount,
        status: posSales.status,
        voidReason: posSales.voidReason,
        voidedAt: posSales.voidedAt,
        notes: posSales.notes,
        createdAt: posSales.createdAt,
      })
      .from(posSales)
      .innerJoin(branches, eq(branches.id, posSales.branchId))
      .where(
        and(
          eq(posSales.id, data.id),
          eq(posSales.tenantId, auth.tenantId),
          // JUR-135: a restricted member shouldn't even discover that
          // a cross-branch sale exists, so we fold the scope into the
          // WHERE — yields the same "Transaksi tidak ditemukan"
          // message as a genuinely-missing row.
          branchScopeWhere(auth, posSales.branchId),
        ),
      )
      .limit(1)
    if (!sale) throw new Error('Transaksi tidak ditemukan')

    const items = await db
      .select({
        id: posSaleItems.id,
        itemId: posSaleItems.itemId,
        nameSnapshot: posSaleItems.nameSnapshot,
        skuSnapshot: posSaleItems.skuSnapshot,
        qty: posSaleItems.qty,
        unitPrice: posSaleItems.unitPrice,
        subtotal: posSaleItems.subtotal,
        hppAtSale: posSaleItems.hppAtSale,
        isAdhoc: posSaleItems.isAdhoc,
      })
      .from(posSaleItems)
      .where(eq(posSaleItems.saleId, data.id))
      .orderBy(posSaleItems.createdAt)

    return {
      ...sale,
      items,
    }
  })

// ─── Void (same-day) ─────────────────────────────────────────────────

export const voidSale = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      reason: z.string().min(1, 'Alasan pembatalan wajib diisi').max(500),
      // JUR-204: optional structured category id from
      // pos_void_categories. Optional rather than required so legacy
      // callers (or a mobile build that hasn't shipped the picker yet)
      // still go through.
      categoryId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    // JUR-207: defence in depth alongside the same-day rule below.
    // Matches the client-side canVoidSale(has) → has('pos.transact').
    if (!auth.permissions.includes('pos.transact')) {
      throw new Error(
        'Anda tidak memiliki izin untuk membatalkan transaksi.',
      )
    }

    const [sale] = await db
      .select()
      .from(posSales)
      .where(
        and(
          eq(posSales.id, data.id),
          eq(posSales.tenantId, auth.tenantId),
          // JUR-135: same 404-via-scope pattern as getSale.
          branchScopeWhere(auth, posSales.branchId),
        ),
      )
      .limit(1)
    if (!sale) throw new Error('Transaksi tidak ditemukan')
    if (sale.status === 'voided') {
      throw new Error('Transaksi sudah pernah dibatalkan')
    }

    // Same-day rule: refuse if the sale's Jakarta calendar day != today.
    const saleDateKey = dateKeyJakarta(new Date(sale.createdAt))
    const todayKey = dateKeyJakarta(new Date())
    if (saleDateKey !== todayKey) {
      throw new Error(
        'Transaksi ini sudah lewat hari — pembatalan hanya bisa di hari yang sama. Hubungi admin untuk refund.',
      )
    }

    const now = new Date()

    // JUR-141 Peti Kas: voiding a cash sale needs to land in whichever
    // session is OPEN right now for (branch, cashier of the void
    // caller). JUR-145 PR 4: Komplit-only — free / legacy tenants
    // skip the kas write entirely.
    let voidCashSessionId: string | null = null
    if (sale.paymentMethod === 'cash' && auth.posTier === 'komplit') {
      const [settingsRow] = await db
        .select({ enabled: posSettings.cashDrawerEnabled })
        .from(posSettings)
        .where(eq(posSettings.tenantId, auth.tenantId))
        .limit(1)
      if (settingsRow?.enabled ?? true) {
        const session = await findOpenSession(
          auth.tenantId,
          sale.branchId,
          auth.userId,
        )
        if (!session) {
          throw new Error(
            'Buka Kas dulu untuk mencatat refund tunai pada sesi yang berjalan.',
          )
        }
        voidCashSessionId = session.id
      }
    }

    // JUR-204: validate the category id belongs to this tenant before
    // we persist it. Skipping the FK at the DB level (matches voided_by)
    // means we check ownership here so a hostile client can't store an
    // arbitrary uuid in the column.
    if (data.categoryId) {
      const [cat] = await db
        .select({ id: posVoidCategories.id })
        .from(posVoidCategories)
        .where(
          and(
            eq(posVoidCategories.id, data.categoryId),
            eq(posVoidCategories.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!cat) throw new Error('Kategori pembatalan tidak ditemukan')
    }

    await db.transaction(async (tx) => {
      await tx
        .update(posSales)
        .set({
          status: 'voided',
          voidReason: data.reason,
          voidCategoryId: data.categoryId ?? null,
          voidedAt: now,
          voidedBy: auth.userId,
        })
        .where(eq(posSales.id, sale.id))

      // JUR-156: drop the linked cashflow income row so the ledger's
      // net stays correct. Unconditional — a no-op when the sale never
      // produced an entry (non-Komplit at sale time).
      await removePosSaleCashflowEntry(tx as unknown as typeof db, {
        tenantId: auth.tenantId,
        saleId: sale.id,
      })

      // JUR-141: refund movement to the current open session (already
      // validated above). Amount = sale.total (net cash that left the
      // till — matches the createSale credit side).
      if (voidCashSessionId) {
        await insertCashMovement(tx as unknown as typeof db, {
          tenantId: auth.tenantId,
          sessionId: voidCashSessionId,
          type: 'refund',
          amount: Number(sale.total),
          referenceSaleId: sale.id,
          createdByUserId: auth.userId,
        })
      }

      // Reverse customer aggregates (JUR-6). If the sale was linked to
      // a customer, decrement total_spent + visit_count. last_visit_at
      // is left as-is — it captured "when the customer last walked in"
      // at the time of the sale, not "when the last completed sale
      // happened", so a void doesn't retroactively hide that visit.
      if (sale.customerId) {
        await tx
          .update(customers)
          .set({
            totalSpent: sql`GREATEST(0, ${customers.totalSpent} - ${sale.total})`,
            visitCount: sql`GREATEST(0, ${customers.visitCount} - 1)`,
            updatedAt: now,
          })
          .where(eq(customers.id, sale.customerId))
      }

      // Reverse loyalty movements (JUR-8). Earn becomes a compensating
      // 'adjust' (subtract) and redeem becomes a compensating 'adjust'
      // (add back) — using 'adjust' rather than re-typing earn/redeem
      // keeps the sale_id linkage clean and lets reports filter the
      // ledger by type without seeing voided earns as still-earned. The
      // balance row is bumped by the same net delta.
      const earnedPts = Number(sale.loyaltyPointsEarned ?? 0)
      const redeemedPts = Number(sale.loyaltyPointsRedeemed ?? 0)
      if (sale.customerId && (earnedPts > 0 || redeemedPts > 0)) {
        if (earnedPts > 0) {
          await tx.insert(customerLoyaltyMovements).values({
            tenantId: auth.tenantId,
            customerId: sale.customerId,
            type: 'adjust',
            points: earnedPts.toString(),
            saleId: sale.id,
            reason: `Reverse earn: ${sale.saleNumber} dibatalkan`,
            performedBy: auth.userId,
          })
        }
        if (redeemedPts > 0) {
          await tx.insert(customerLoyaltyMovements).values({
            tenantId: auth.tenantId,
            customerId: sale.customerId,
            type: 'adjust',
            points: redeemedPts.toString(),
            saleId: sale.id,
            reason: `Reverse redeem: ${sale.saleNumber} dibatalkan`,
            performedBy: auth.userId,
          })
        }
        // Net delta on the balance: subtract what was earned, add back
        // what was redeemed. lifetime_* counters are NOT reversed —
        // they're a historical record (the customer DID earn those
        // points before the void), so leaving them captures lifetime
        // engagement honestly.
        const netDelta = redeemedPts - earnedPts
        await tx
          .update(customerLoyaltyBalances)
          .set({
            pointsBalance: sql`GREATEST(0, ${customerLoyaltyBalances.pointsBalance} + ${netDelta})`,
            updatedAt: now,
          })
          .where(eq(customerLoyaltyBalances.customerId, sale.customerId))
      }

      // Reverse stamp-card movements (JUR-195). Same pattern as the
      // loyalty-points block above: earn → compensating 'adjust' that
      // drops the balance, redeem → compensating 'adjust' that adds it
      // back. lifetime_stamps / lifetime_rewards are NOT reversed —
      // they're a historical record. Aggregated per card so we emit at
      // most two ledger rows per card regardless of how many original
      // earn/redeem rows the sale produced.
      const stampMovements = await tx
        .select({
          cardId: customerStampMovements.cardId,
          type: customerStampMovements.type,
          stamps: customerStampMovements.stamps,
        })
        .from(customerStampMovements)
        .where(eq(customerStampMovements.saleId, sale.id))

      const earnByCard = new Map<string, number>()
      const redeemByCard = new Map<string, number>()
      for (const mv of stampMovements) {
        if (mv.type === 'earn') {
          earnByCard.set(mv.cardId, (earnByCard.get(mv.cardId) ?? 0) + mv.stamps)
        } else if (mv.type === 'redeem') {
          redeemByCard.set(
            mv.cardId,
            (redeemByCard.get(mv.cardId) ?? 0) + mv.stamps,
          )
        }
        // 'adjust' rows are skipped — they're not part of this sale's
        // earn/redeem flow even if they happen to share the saleId.
      }

      const touchedStampCards = new Set<string>([
        ...earnByCard.keys(),
        ...redeemByCard.keys(),
      ])
      for (const cardId of touchedStampCards) {
        const earned = earnByCard.get(cardId) ?? 0
        const redeemed = redeemByCard.get(cardId) ?? 0
        if (earned > 0) {
          await tx.insert(customerStampMovements).values({
            tenantId: auth.tenantId,
            cardId,
            type: 'adjust',
            stamps: earned,
            saleId: sale.id,
            reason: `Reverse earn: ${sale.saleNumber} dibatalkan`,
            performedBy: auth.userId,
          })
        }
        if (redeemed > 0) {
          await tx.insert(customerStampMovements).values({
            tenantId: auth.tenantId,
            cardId,
            type: 'adjust',
            stamps: redeemed,
            saleId: sale.id,
            reason: `Reverse redeem: ${sale.saleNumber} dibatalkan`,
            performedBy: auth.userId,
          })
        }
        const stampDelta = redeemed - earned
        if (stampDelta !== 0) {
          await tx
            .update(customerStampCards)
            .set({
              currentStamps: sql`GREATEST(0, ${customerStampCards.currentStamps} + ${stampDelta})`,
              updatedAt: now,
            })
            .where(eq(customerStampCards.id, cardId))
        }
      }

      // Reverse each non-adhoc line's stock movement: insert a
      // compensating 'in' movement + bump the balance back. Use the
      // base-unit qty stored at sale time so the void cancels out
      // exactly the same number of base units that were deducted.
      // Service-mode (linkedHppProductId set) lines are skipped here —
      // no out was emitted at sale time, so no in is needed at void
      // time. The ingredient-reversal loop below handles their actual
      // stock effect.
      const lines = await tx
        .select({
          id: posSaleItems.id,
          itemId: posSaleItems.itemId,
          variantId: posSaleItems.variantId,
          variantLabel: posSaleItems.variantLabel,
          qty: posSaleItems.qty,
          qtyInBase: posSaleItems.qtyInBase,
          hppAtSale: posSaleItems.hppAtSale,
          linkedHppProductId: inventoryItems.linkedHppProductId,
        })
        .from(posSaleItems)
        .leftJoin(inventoryItems, eq(inventoryItems.id, posSaleItems.itemId))
        .where(eq(posSaleItems.saleId, sale.id))

      for (const line of lines) {
        if (!line.itemId) continue // ad-hoc — no inventory effect
        const baseQty = line.qtyInBase ?? line.qty // fallback for legacy rows

        // Variant line — restock the chosen variant's balance.
        if (line.variantId) {
          await tx.insert(inventoryMovements).values({
            tenantId: auth.tenantId,
            itemId: line.itemId,
            variantId: line.variantId,
            branchId: sale.branchId,
            movementType: 'in',
            quantity: baseQty,
            unitCost: line.hppAtSale,
            reason: 'pos_void',
            referenceType: 'pos_sale',
            referenceId: sale.id,
            notes: `Pembatalan ${sale.saleNumber}: ${data.reason}${line.variantLabel ? ` (${line.variantLabel})` : ''}`,
            performedBy: auth.userId,
          })
          const [existingV] = await tx
            .select({
              id: inventoryItemVariantStock.id,
              quantity: inventoryItemVariantStock.quantity,
            })
            .from(inventoryItemVariantStock)
            .where(
              and(
                eq(inventoryItemVariantStock.variantId, line.variantId),
                eq(inventoryItemVariantStock.branchId, sale.branchId),
              ),
            )
            .limit(1)
          if (existingV) {
            await tx
              .update(inventoryItemVariantStock)
              .set({
                quantity: (Number(existingV.quantity) + Number(baseQty)).toString(),
                lastMovementAt: now,
                updatedAt: now,
              })
              .where(eq(inventoryItemVariantStock.id, existingV.id))
          } else {
            await tx.insert(inventoryItemVariantStock).values({
              tenantId: auth.tenantId,
              variantId: line.variantId,
              branchId: sale.branchId,
              quantity: baseQty,
              lastMovementAt: now,
            })
          }
          continue
        }

        if (line.linkedHppProductId) continue // service-mode — no own stock

        await tx.insert(inventoryMovements).values({
          tenantId: auth.tenantId,
          itemId: line.itemId,
          branchId: sale.branchId,
          movementType: 'in',
          quantity: baseQty,
          unitCost: line.hppAtSale,
          reason: 'pos_void',
          referenceType: 'pos_sale',
          referenceId: sale.id,
          notes: `Pembatalan ${sale.saleNumber}: ${data.reason}`,
          performedBy: auth.userId,
        })

        const [existing] = await tx
          .select({
            id: inventoryStockBalances.id,
            quantity: inventoryStockBalances.quantity,
          })
          .from(inventoryStockBalances)
          .where(
            and(
              eq(inventoryStockBalances.itemId, line.itemId),
              eq(inventoryStockBalances.branchId, sale.branchId),
            ),
          )
          .limit(1)
        if (existing) {
          const newQty = Number(existing.quantity) + Number(baseQty)
          await tx
            .update(inventoryStockBalances)
            .set({
              quantity: newQty.toString(),
              lastMovementAt: now,
              updatedAt: now,
            })
            .where(eq(inventoryStockBalances.id, existing.id))
        } else {
          await tx.insert(inventoryStockBalances).values({
            tenantId: auth.tenantId,
            itemId: line.itemId,
            branchId: sale.branchId,
            quantity: baseQty,
            lastMovementAt: now,
          })
        }
      }

      // Ingredient reversal (JUR-10). The original sale may have
      // emitted N stock-out movements per parent line (one per BOM
      // material). We reverse each by querying the ledger for movements
      // with reason='pos_sale_ingredient' + reference_id=sale.id and
      // bumping the matching balance back. Done as a batch query +
      // per-row reverse so we don't depend on the BOM still being the
      // same shape as at sale time (recipe edits between sale + void
      // wouldn't desync the reversal).
      const ingredientMovements = await tx
        .select({
          id: inventoryMovements.id,
          itemId: inventoryMovements.itemId,
          branchId: inventoryMovements.branchId,
          quantity: inventoryMovements.quantity,
          unitCost: inventoryMovements.unitCost,
          notes: inventoryMovements.notes,
        })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.referenceType, 'pos_sale'),
            eq(inventoryMovements.referenceId, sale.id),
            eq(inventoryMovements.reason, 'pos_sale_ingredient'),
          ),
        )

      for (const mvmt of ingredientMovements) {
        if (!mvmt.itemId || !mvmt.branchId) continue
        const baseQty = Number(mvmt.quantity)

        await tx.insert(inventoryMovements).values({
          tenantId: auth.tenantId,
          itemId: mvmt.itemId,
          branchId: mvmt.branchId,
          movementType: 'in',
          quantity: baseQty.toString(),
          unitCost: mvmt.unitCost,
          // 'pos_void_ingredient' so reports can split parent-product
          // voids from ingredient-line voids if needed; both stem from
          // the same sale void.
          reason: 'pos_void_ingredient',
          referenceType: 'pos_sale',
          referenceId: sale.id,
          notes: `Pembatalan ${sale.saleNumber}: ${mvmt.notes ?? 'bahan'}`,
          performedBy: auth.userId,
        })

        const [existing] = await tx
          .select({
            id: inventoryStockBalances.id,
            quantity: inventoryStockBalances.quantity,
          })
          .from(inventoryStockBalances)
          .where(
            and(
              eq(inventoryStockBalances.itemId, mvmt.itemId),
              eq(inventoryStockBalances.branchId, mvmt.branchId),
            ),
          )
          .limit(1)
        if (existing) {
          const newQty = Number(existing.quantity) + baseQty
          await tx
            .update(inventoryStockBalances)
            .set({
              quantity: newQty.toString(),
              lastMovementAt: now,
              updatedAt: now,
            })
            .where(eq(inventoryStockBalances.id, existing.id))
        } else {
          await tx.insert(inventoryStockBalances).values({
            tenantId: auth.tenantId,
            itemId: mvmt.itemId,
            branchId: mvmt.branchId,
            quantity: baseQty.toString(),
            lastMovementAt: now,
          })
        }
      }
    })

    return { success: true as const }
  })

// ─── Sales history ───────────────────────────────────────────────────

const listSalesInput = z.object({
  branchId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['completed', 'voided']).optional(),
  paymentMethod: z
    .enum(['cash', 'qris', 'transfer', 'card', 'ewallet', 'gopay', 'shopeepay', 'ovo'])
    .optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
})

export const listSales = createServerFn({ method: 'POST' })
  .inputValidator(listSalesInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    const limits = posTierLimits(auth.posTier)

    // Free clamps `from` to (today - historyDays). Toko+ unlimited.
    let effectiveFrom = data.from
    if (limits.historyDays != null) {
      const earliest = new Date()
      earliest.setDate(earliest.getDate() - limits.historyDays)
      const earliestKey = earliest.toISOString().slice(0, 10)
      if (!effectiveFrom || effectiveFrom < earliestKey) {
        effectiveFrom = earliestKey
      }
    }

    // Base filters shared by the list, the count, AND the payment
    // summary: tenant + branch scope + date range.
    const baseConds = [eq(posSales.tenantId, auth.tenantId)]
    if (data.branchId) {
      // JUR-135: if caller explicitly filters by a branch, they must
      // have access to it. Fail fast rather than silently returning
      // empty (which would look like "no sales here" instead of
      // "you're not allowed").
      assertBranchAllowed(auth, data.branchId)
      baseConds.push(eq(posSales.branchId, data.branchId))
    } else {
      // No explicit filter: scope to the member's allowed branch set
      // (no-op for unrestricted callers).
      const scope = branchScopeWhere(auth, posSales.branchId)
      if (scope) baseConds.push(scope)
    }
    if (effectiveFrom) {
      baseConds.push(gte(posSales.createdAt, new Date(`${effectiveFrom}T00:00:00`)))
    }
    if (data.to) {
      baseConds.push(lte(posSales.createdAt, new Date(`${data.to}T23:59:59`)))
    }

    // The list + count additionally honour the status / payment-method
    // filters the user picked.
    const conds = [...baseConds]
    if (data.status) conds.push(eq(posSales.status, data.status))
    if (data.paymentMethod) conds.push(eq(posSales.paymentMethod, data.paymentMethod))

    const offset = (data.page - 1) * data.pageSize
    const rows = await db
      .select({
        id: posSales.id,
        saleNumber: posSales.saleNumber,
        branchId: posSales.branchId,
        branchName: branches.name,
        cashierUserId: posSales.cashierUserId,
        customerName: posSales.customerName,
        total: posSales.total,
        paymentMethod: posSales.paymentMethod,
        status: posSales.status,
        createdAt: posSales.createdAt,
      })
      .from(posSales)
      .innerJoin(branches, eq(branches.id, posSales.branchId))
      .where(and(...conds))
      .orderBy(desc(posSales.createdAt))
      .limit(data.pageSize)
      .offset(offset)

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posSales)
      .where(and(...conds))

    // Payment-method reconciliation summary. Completed sales only —
    // voided sales took no money — and deliberately ignores the
    // payment-method filter so the full split stays visible even when
    // the list below is filtered to a single method.
    const byPaymentMethod = await db
      .select({
        method: posSales.paymentMethod,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${posSales.total}), 0)::float8`,
      })
      .from(posSales)
      .where(and(...baseConds, eq(posSales.status, 'completed')))
      .groupBy(posSales.paymentMethod)

    return {
      sales: rows,
      total: countRow?.count ?? 0,
      byPaymentMethod,
      historyClampedDays: limits.historyDays,
    }
  })

// ─── Daily Z-report (Toko+) ──────────────────────────────────────────

export const getDailyZReport = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'daily_zreport')

    // ::timestamp cast forces postgres to interpret the date as a
    // wall-clock instant in Jakarta (and convert to UTC). Without the
    // cast, postgres routes through the date→timestamptz coercion
    // which assumes session TZ — wrong day boundary.
    const startUtc = sql`((${data.date}::date::timestamp) AT TIME ZONE 'Asia/Jakarta')`
    const endUtc = sql`(((${data.date}::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta')`

    // JUR-135: scope to the member's allowed branches. If the caller
    // explicitly passes branchId, we still check it belongs to the
    // allowed set; otherwise we filter by the full set.
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const branchClause = data.branchId
      ? sql`AND s.branch_id = ${data.branchId}`
      : auth.allowedBranchIds === null
        ? sql``
        : sql`AND s.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`

    const totalsRow = await db.execute<{
      sales_count: number
      voided_count: number
      total_revenue: number | null
    }>(sql`
      SELECT
        SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END)::int AS sales_count,
        SUM(CASE WHEN s.status = 'voided' THEN 1 ELSE 0 END)::int AS voided_count,
        COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total::numeric ELSE 0 END), 0) AS total_revenue
      FROM pos_sales s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
    `)

    const byMethod = await db.execute<{
      payment_method: string
      count: number
      total: number | null
    }>(sql`
      SELECT s.payment_method,
             count(*)::int AS count,
             COALESCE(SUM(s.total::numeric), 0) AS total
      FROM pos_sales s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY s.payment_method
      ORDER BY total DESC
    `)

    const topItems = await db.execute<{
      name_snapshot: string
      qty_sold: string
      revenue: number | null
    }>(sql`
      SELECT li.name_snapshot,
             SUM(li.qty::numeric) AS qty_sold,
             COALESCE(SUM(li.subtotal::numeric), 0) AS revenue
      FROM pos_sale_items li
      JOIN pos_sales s ON s.id = li.sale_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY li.name_snapshot
      ORDER BY qty_sold DESC
      LIMIT 5
    `)

    // JUR-141 Rekonsiliasi Kas — every cash session opened on this
    // date (in Jakarta wall-clock terms). Closed sessions show their
    // variance; still-open sessions show the running expected. Owner
    // sees the sum at the bottom so a -Rp 50k tenant-wide shortfall
    // is unmissable.
    const cashSessionsRaw = await db.execute<{
      id: string
      branch_name: string
      cashier_user_id: string
      first_name: string | null
      last_name: string | null
      status: string
      opening_balance: string
      cash_in_total: string
      cash_out_total: string
      expected_closing: string | null
      actual_closing: string | null
      variance: string | null
      force_closed: boolean
    }>(sql`
      SELECT s.id, b.name AS branch_name, s.cashier_user_id,
             tm.first_name, tm.last_name,
             s.status, s.opening_balance,
             s.cash_in_total, s.cash_out_total,
             s.expected_closing, s.actual_closing, s.variance, s.force_closed
      FROM pos_cash_sessions s
      JOIN branches b ON b.id = s.branch_id
      LEFT JOIN tenant_members tm
        ON tm.tenant_id = s.tenant_id AND tm.user_id = s.cashier_user_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.opened_at >= ${startUtc}
        AND s.opened_at <  ${endUtc}
        ${
          data.branchId
            ? sql`AND s.branch_id = ${data.branchId}`
            : auth.allowedBranchIds === null
              ? sql``
              : sql`AND s.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`
        }
      ORDER BY s.opened_at
    `)

    const cashSessions = cashSessionsRaw.map((r) => {
      const opening = parseFloat(r.opening_balance)
      const inTotal = parseFloat(r.cash_in_total)
      const outTotal = parseFloat(r.cash_out_total)
      const expectedNow =
        r.status === 'closed'
          ? parseFloat(r.expected_closing ?? '0')
          : opening + inTotal - outTotal
      return {
        id: r.id,
        branchName: r.branch_name,
        cashierName:
          [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
        status: r.status as 'open' | 'closed',
        openingBalance: opening,
        expectedClosing: expectedNow,
        actualClosing:
          r.actual_closing != null ? parseFloat(r.actual_closing) : null,
        variance: r.variance != null ? parseFloat(r.variance) : null,
        forceClosed: r.force_closed,
      }
    })
    // Closed sessions contribute to the day's total variance.
    // Open + force-closed sessions are excluded — their variance
    // isn't a real shortage/surplus signal.
    const totalVariance = cashSessions
      .filter((s) => s.status === 'closed' && !s.forceClosed)
      .reduce((acc, s) => acc + (s.variance ?? 0), 0)

    const totals = totalsRow[0]
    return {
      date: data.date,
      branchId: data.branchId ?? null,
      salesCount: Number(totals?.sales_count ?? 0),
      voidedCount: Number(totals?.voided_count ?? 0),
      totalRevenue: Number(totals?.total_revenue ?? 0),
      byPaymentMethod: byMethod.map((r) => ({
        method: r.payment_method as POSPaymentMethod,
        count: Number(r.count),
        total: Number(r.total ?? 0),
      })),
      topItems: topItems.map((r) => ({
        name: r.name_snapshot,
        qtySold: Number(r.qty_sold),
        revenue: Number(r.revenue ?? 0),
      })),
      cashReconciliation: {
        sessions: cashSessions,
        totalVariance,
      },
    }
  })

// ─── P&L / monthly report (Toko+) ────────────────────────────────────

/**
 * JUR-11: profit-and-loss report for a custom date range. Single
 * server fn — caller picks the date window + optional branch filter.
 * All math is straight aggregations against `pos_sales` +
 * `pos_sale_items` (the snapshot columns we've been writing across
 * W1-W4 are already there: hppAtSale per line, discountAmount +
 * lineDiscountAmount, taxAmount, loyaltyRedeemAmount).
 *
 * Date window is inclusive on `from` (00:00 Jakarta) and exclusive on
 * `to + 1 day` (so a "31 Mar 2026" range covers 31 Mar 00:00 to 1 Apr
 * 00:00 Jakarta). Same `::timestamp before AT TIME ZONE` cast as the
 * Z-report — direct date→timestamptz coercion uses session TZ which
 * is wrong on the server.
 */
export const getPOSReport = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'pl_report')
    // Gate on pos.report.view so cashiers (who have pos.read for
    // /pos/sales history but not pos.report.view) can't hit the URL
    // directly and pull tenant-wide P&L.
    if (!auth.permissions.includes('pos.report.view')) {
      throw new Error(
        'Anda tidak memiliki akses ke laporan POS. Hubungi pemilik.',
      )
    }
    // Owner-only sub-gate: HPP / untung kotor / margin are sensitive
    // even within pos.report.view holders. Supervisor sees revenue +
    // counts; only callers with pos.report.profit get cost-based math.
    const canSeeProfit = auth.permissions.includes('pos.report.profit')

    const startUtc = sql`((${data.from}::date::timestamp) AT TIME ZONE 'Asia/Jakarta')`
    // End is exclusive — `to + 1 day` so a single-day range still covers
    // the whole day. Mirrors how listSales clamps from/to.
    const endUtc = sql`(((${data.to}::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta')`

    // JUR-135: scope to allowed branches. If caller explicitly passes
    // branchId, it must be in the allowed set. Inner subqueries that
    // join pos_sale_items → pos_sales reuse the same clause via the
    // `s2.branch_id` column (still `branch_id` in the table).
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const branchClause = data.branchId
      ? sql`AND s.branch_id = ${data.branchId}`
      : auth.allowedBranchIds === null
        ? sql``
        : sql`AND s.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`
    const branchClauseS2 = data.branchId
      ? sql`AND s2.branch_id = ${data.branchId}`
      : auth.allowedBranchIds === null
        ? sql``
        : sql`AND s2.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`

    // Headline aggregations — single round-trip pulls all the totals
    // the ringkasan card needs. Discounts are split into line vs sale
    // so the report can show them separately (line discounts come from
    // pos_sale_items, sale-level from pos_sales).
    const summaryRow = await db.execute<{
      sales_count: number
      voided_count: number
      revenue: number | null
      hpp_cost: number | null
      sale_discount_total: number | null
      line_discount_total: number | null
      promo_total: number | null
      tax_total: number | null
      loyalty_redeem_total: number | null
      voided_total: number | null
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE s.status = 'completed')::int AS sales_count,
        COUNT(*) FILTER (WHERE s.status = 'voided')::int AS voided_count,
        COALESCE(SUM(s.total::numeric) FILTER (WHERE s.status = 'completed'), 0) AS revenue,
        COALESCE((
          SELECT SUM(li.qty::numeric * COALESCE(li.hpp_at_sale, 0)::numeric)
          FROM pos_sale_items li
          JOIN pos_sales s2 ON s2.id = li.sale_id
          WHERE s2.tenant_id = ${auth.tenantId}
            AND s2.status = 'completed'
            AND s2.created_at >= ${startUtc}
            AND s2.created_at <  ${endUtc}
            ${branchClauseS2}
        ), 0) AS hpp_cost,
        COALESCE(SUM(s.discount_amount::numeric) FILTER (WHERE s.status = 'completed'), 0) AS sale_discount_total,
        COALESCE((
          SELECT SUM(li.line_discount_amount::numeric)
          FROM pos_sale_items li
          JOIN pos_sales s2 ON s2.id = li.sale_id
          WHERE s2.tenant_id = ${auth.tenantId}
            AND s2.status = 'completed'
            AND s2.created_at >= ${startUtc}
            AND s2.created_at <  ${endUtc}
            ${branchClauseS2}
        ), 0) AS line_discount_total,
        COALESCE(SUM(s.promo_amount::numeric) FILTER (WHERE s.status = 'completed'), 0) AS promo_total,
        COALESCE(SUM(s.tax_amount::numeric) FILTER (WHERE s.status = 'completed'), 0) AS tax_total,
        COALESCE(SUM(s.loyalty_redeem_amount::numeric) FILTER (WHERE s.status = 'completed'), 0) AS loyalty_redeem_total,
        COALESCE(SUM(s.total::numeric) FILTER (WHERE s.status = 'voided'), 0) AS voided_total
      FROM pos_sales s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
    `)

    // Top items — separate sort orders for "best by qty" vs "best by
    // revenue". Limit 10 each (more than 10 makes the panel scroll-
    // heavy; the owner can drill into Sales for full detail).
    const topByQty = await db.execute<{
      name_snapshot: string
      qty_sold: string
      revenue: number | null
    }>(sql`
      SELECT li.name_snapshot,
             SUM(li.qty::numeric) AS qty_sold,
             COALESCE(SUM(li.subtotal::numeric), 0) AS revenue
      FROM pos_sale_items li
      JOIN pos_sales s ON s.id = li.sale_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY li.name_snapshot
      ORDER BY qty_sold DESC
      LIMIT 10
    `)

    const topByRevenue = await db.execute<{
      name_snapshot: string
      qty_sold: string
      revenue: number | null
    }>(sql`
      SELECT li.name_snapshot,
             SUM(li.qty::numeric) AS qty_sold,
             COALESCE(SUM(li.subtotal::numeric), 0) AS revenue
      FROM pos_sale_items li
      JOIN pos_sales s ON s.id = li.sale_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY li.name_snapshot
      ORDER BY revenue DESC
      LIMIT 10
    `)

    // Payment-method breakdown — pie chart fodder.
    const byMethod = await db.execute<{
      payment_method: string
      count: number
      total: number | null
    }>(sql`
      SELECT s.payment_method,
             count(*)::int AS count,
             COALESCE(SUM(s.total::numeric), 0) AS total
      FROM pos_sales s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY s.payment_method
      ORDER BY total DESC
    `)

    // JUR-204: Peti Kas summary tiles on the reports page. Glance-only;
    // owner clicks through to /pos/cash-sessions for per-session detail.
    // Sessions counted by openedAt; manual movement totals (drop+payout)
    // counted by movement created_at. Both honour the branch scope.
    const branchClauseSes = data.branchId
      ? sql`AND s.branch_id = ${data.branchId}`
      : auth.allowedBranchIds === null
        ? sql``
        : sql`AND s.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`
    const petiKasSessionsRow = await db.execute<{
      sessions_opened: number
      variance_total: number | null
    }>(sql`
      SELECT
        COUNT(*)::int AS sessions_opened,
        COALESCE(SUM(s.variance::numeric)
                 FILTER (WHERE s.status = 'closed'), 0) AS variance_total
      FROM pos_cash_sessions s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.opened_at >= ${startUtc}
        AND s.opened_at <  ${endUtc}
        ${branchClauseSes}
    `)
    // Movement totals — JOIN to sessions to apply the same branch scope
    // (pos_cash_movements doesn't carry branch_id directly).
    const petiKasMovementsRow = await db.execute<{
      drop_total: number | null
      payout_total: number | null
    }>(sql`
      SELECT
        COALESCE(SUM(mv.amount::numeric)
                 FILTER (WHERE mv.type = 'drop'), 0)  AS drop_total,
        COALESCE(SUM(mv.amount::numeric)
                 FILTER (WHERE mv.type = 'payout'), 0) AS payout_total
      FROM pos_cash_movements mv
      JOIN pos_cash_sessions s ON s.id = mv.session_id
      WHERE mv.tenant_id = ${auth.tenantId}
        AND mv.created_at >= ${startUtc}
        AND mv.created_at <  ${endUtc}
        ${branchClauseSes}
    `)

    // JUR-204: voids-by-category breakdown — owner uses this to spot
    // the most common cancellation reason. LEFT JOIN so voids with a
    // NULL category (legacy rows + the optional path) bucket as
    // "Tanpa kategori" instead of being dropped from the count.
    const byVoidCategory = await db.execute<{
      label: string | null
      count: number
    }>(sql`
      SELECT c.label, count(*)::int AS count
      FROM pos_sales s
      LEFT JOIN pos_void_categories c ON c.id = s.void_category_id
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'voided'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY c.label
      ORDER BY count DESC
    `)

    // Cashier breakdown — only meaningful when ≥2 distinct cashiers
    // sold in the range. Client decides whether to render based on
    // length > 1.
    const byCashier = await db.execute<{
      cashier_user_id: string
      count: number
      total: number | null
    }>(sql`
      SELECT s.cashier_user_id,
             count(*)::int AS count,
             COALESCE(SUM(s.total::numeric), 0) AS total
      FROM pos_sales s
      WHERE s.tenant_id = ${auth.tenantId}
        AND s.status = 'completed'
        AND s.created_at >= ${startUtc}
        AND s.created_at <  ${endUtc}
        ${branchClause}
      GROUP BY s.cashier_user_id
      ORDER BY total DESC
    `)

    // Resolve cashier names. Auth users live in Supabase, so we hit
    // the admin API per id. Cheap when there are few cashiers; if a
    // tenant ever scales to 50+ cashiers in a window we can batch.
    const cashierIds = byCashier.map((c) => c.cashier_user_id)
    const cashierNames = new Map<string, string>()
    if (cashierIds.length > 0) {
      const supa = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
      )
      for (const id of cashierIds) {
        try {
          const { data: u } = await supa.auth.admin.getUserById(id)
          const display =
            (u?.user?.user_metadata?.full_name as string | undefined) ??
            u?.user?.email ??
            id.slice(0, 8)
          cashierNames.set(id, display)
        } catch {
          cashierNames.set(id, id.slice(0, 8))
        }
      }
    }

    const summary = summaryRow[0]
    const revenue = Number(summary?.revenue ?? 0)
    const hppCostRaw = Number(summary?.hpp_cost ?? 0)
    const grossMarginRaw = revenue - hppCostRaw
    const grossMarginPctRaw = revenue > 0 ? (grossMarginRaw / revenue) * 100 : 0
    // Defense in depth: don't ship the cost-side numbers to a caller
    // who lacks pos.report.profit. The client also hides the cards,
    // but zeroing here means an API spelunker can't pull the values.
    const hppCost = canSeeProfit ? hppCostRaw : 0
    const grossMargin = canSeeProfit ? grossMarginRaw : 0
    const grossMarginPct = canSeeProfit ? grossMarginPctRaw : 0

    return {
      from: data.from,
      to: data.to,
      branchId: data.branchId ?? null,
      canSeeProfit,
      summary: {
        salesCount: Number(summary?.sales_count ?? 0),
        voidedCount: Number(summary?.voided_count ?? 0),
        revenue,
        hppCost,
        grossMargin,
        grossMarginPct,
        saleDiscountTotal: Number(summary?.sale_discount_total ?? 0),
        lineDiscountTotal: Number(summary?.line_discount_total ?? 0),
        promoTotal: Number(summary?.promo_total ?? 0),
        taxTotal: Number(summary?.tax_total ?? 0),
        loyaltyRedeemTotal: Number(summary?.loyalty_redeem_total ?? 0),
        voidedTotal: Number(summary?.voided_total ?? 0),
      },
      topByQty: topByQty.map((r) => ({
        name: r.name_snapshot,
        qtySold: Number(r.qty_sold),
        revenue: Number(r.revenue ?? 0),
      })),
      topByRevenue: topByRevenue.map((r) => ({
        name: r.name_snapshot,
        qtySold: Number(r.qty_sold),
        revenue: Number(r.revenue ?? 0),
      })),
      byPaymentMethod: byMethod.map((r) => ({
        method: r.payment_method as POSPaymentMethod,
        count: Number(r.count),
        total: Number(r.total ?? 0),
      })),
      byCashier: byCashier.map((r) => ({
        userId: r.cashier_user_id,
        name: cashierNames.get(r.cashier_user_id) ?? r.cashier_user_id.slice(0, 8),
        count: Number(r.count),
        total: Number(r.total ?? 0),
      })),
      voidsByCategory: byVoidCategory.map((r) => ({
        label: r.label ?? 'Tanpa kategori',
        count: Number(r.count),
      })),
      petiKas: {
        sessionsOpened: Number(petiKasSessionsRow[0]?.sessions_opened ?? 0),
        varianceTotal: Number(petiKasSessionsRow[0]?.variance_total ?? 0),
        dropTotal: Number(petiKasMovementsRow[0]?.drop_total ?? 0),
        payoutTotal: Number(petiKasMovementsRow[0]?.payout_total ?? 0),
      },
    }
  })

// ─── POS settings (Toko+) ────────────────────────────────────────────

const updateSettingsInput = z.object({
  /**
   * Multi-tax stack. Whole array gets replaced on each save (the
   * settings page edits in-place; partial patches aren't supported).
   * Empty array is valid and means "no tax". 10 rows is plenty —
   * cap protects against malicious payloads, not legitimate use.
   */
  taxes: z
    .array(
      z.object({
        label: z.string().min(1, 'Label wajib diisi').max(30),
        percent: z.coerce.number().min(0).max(100),
        active: z.boolean(),
      }),
    )
    .max(10)
    .optional(),
  receiptFooterText: z.string().max(500).optional().nullable(),
  defaultPaymentMethods: z
    .array(z.enum(['cash', 'qris', 'transfer', 'card', 'ewallet', 'gopay', 'shopeepay', 'ovo']))
    .min(1)
    .optional(),
  /**
   * Bank accounts surfaced when paying via Transfer Bank. Whole array
   * is replaced on each save (same model as `taxes`). Empty array is
   * valid and means "no accounts configured". 10 rows is plenty.
   */
  bankAccounts: z
    .array(
      z.object({
        bankName: z.string().min(1, 'Nama bank wajib diisi').max(40),
        accountNumber: z
          .string()
          .min(1, 'Nomor rekening wajib diisi')
          .max(40),
        accountHolder: z
          .string()
          .min(1, 'Nama pemilik rekening wajib diisi')
          .max(80),
        active: z.boolean(),
      }),
    )
    .max(10)
    .optional(),
  /** Loyalty config (Komplit feature). All optional so the settings
   *  page can save just the fields it owns. */
  loyaltyEnabled: z.boolean().optional(),
  /**
   * Earn mode. 'linear' uses earnRate as a per-Rp multiplier;
   * 'per_step' uses (earnStepAmount, earnStepPoints) for "N pts per
   * Rp X" rewards. Defaults to 'linear' on the column so omitting
   * this field on a fresh tenant keeps legacy behaviour.
   */
  loyaltyEarnMode: z.enum(['linear', 'per_step']).optional(),
  /** Points awarded per Rp spent — e.g. 0.001 = 1 pt per Rp 1.000 (linear mode). */
  loyaltyEarnRate: z.coerce.number().min(0).optional(),
  /** per_step threshold: spend per "step" — e.g. 15000. */
  loyaltyEarnStepAmount: z.coerce.number().min(0).optional(),
  /** per_step reward: points per full step — e.g. 750. */
  loyaltyEarnStepPoints: z.coerce.number().min(0).optional(),
  /** Rp per point on redeem — e.g. 10 = 1 pt = Rp 10. */
  loyaltyRedeemRate: z.coerce.number().min(0).optional(),
})

export const updatePOSSettings = createServerFn({ method: 'POST' })
  .inputValidator(updateSettingsInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'custom_receipt')

    const limits = posTierLimits(auth.posTier)
    if (data.defaultPaymentMethods) {
      // Tier check: no method outside the tier's allowed list.
      for (const m of data.defaultPaymentMethods) {
        if (!limits.paymentMethods.includes(m)) {
          throw new Error(
            `Metode pembayaran "${m}" tidak tersedia di paket Anda.`,
          )
        }
      }
    }

    // Loyalty toggle is gated separately — Komplit only. Mode + step
    // values are part of the same gate.
    if (
      data.loyaltyEnabled !== undefined ||
      data.loyaltyEarnMode !== undefined ||
      data.loyaltyEarnRate !== undefined ||
      data.loyaltyEarnStepAmount !== undefined ||
      data.loyaltyEarnStepPoints !== undefined ||
      data.loyaltyRedeemRate !== undefined
    ) {
      assertPOSFeatureAvailable(auth.posTier, 'loyalty_points')
    }

    const updateSet: Record<string, unknown> = { updatedAt: new Date() }
    if (data.taxes !== undefined) updateSet.taxes = data.taxes
    if (data.receiptFooterText !== undefined) updateSet.receiptFooterText = data.receiptFooterText
    if (data.defaultPaymentMethods !== undefined)
      updateSet.defaultPaymentMethods = data.defaultPaymentMethods
    if (data.bankAccounts !== undefined)
      updateSet.bankAccounts = data.bankAccounts
    if (data.loyaltyEnabled !== undefined)
      updateSet.loyaltyEnabled = data.loyaltyEnabled
    if (data.loyaltyEarnMode !== undefined)
      updateSet.loyaltyEarnMode = data.loyaltyEarnMode
    if (data.loyaltyEarnRate !== undefined)
      updateSet.loyaltyEarnRate = data.loyaltyEarnRate.toString()
    if (data.loyaltyEarnStepAmount !== undefined)
      updateSet.loyaltyEarnStepAmount = data.loyaltyEarnStepAmount.toString()
    if (data.loyaltyEarnStepPoints !== undefined)
      updateSet.loyaltyEarnStepPoints = data.loyaltyEarnStepPoints.toString()
    if (data.loyaltyRedeemRate !== undefined)
      updateSet.loyaltyRedeemRate = data.loyaltyRedeemRate.toString()

    await db
      .insert(posSettings)
      .values({
        tenantId: auth.tenantId,
        ...(updateSet as any),
      })
      .onConflictDoUpdate({
        target: posSettings.tenantId,
        set: updateSet,
      })

    return { success: true as const }
  })

/**
 * Standalone toggle for the cashier "Item Lain" (ad-hoc line) control.
 * Deliberately NOT gated on `custom_receipt` like updatePOSSettings —
 * this is a basic anti-fraud switch every tier (including free) must be
 * able to flip, even though the rest of the settings page is Toko+.
 * Upserts so a free tenant with no pos_settings row yet still lands one.
 */
export const updatePOSAdhocSetting = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    await db
      .insert(posSettings)
      .values({ tenantId: auth.tenantId, adhocItemsEnabled: data.enabled })
      .onConflictDoUpdate({
        target: posSettings.tenantId,
        set: { adhocItemsEnabled: data.enabled, updatedAt: new Date() },
      })
    return { success: true as const }
  })

export const uploadReceiptLogo = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      dataUrl: z.string(),
      /** When set, write the new logo as a per-branch override.
       *  When omitted, replace the tenant default in pos_settings. */
      branchId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'custom_receipt')

    const parsed = parseDataUrl(data.dataUrl)
    if (!parsed) throw new Error('Format gambar tidak valid')

    const { key } = await uploadPOSReceiptLogo({
      tenantId: auth.tenantId,
      bytes: parsed.bytes,
      mimeType: parsed.mimeType,
    })

    if (data.branchId) {
      // Tenant-scoped UPDATE — refuse to write across tenants even
      // if the cashier's payload is malicious.
      const result = await db
        .update(branches)
        .set({ receiptLogoKey: key, updatedAt: new Date() })
        .where(
          and(
            eq(branches.id, data.branchId),
            eq(branches.tenantId, auth.tenantId),
          ),
        )
        .returning({ id: branches.id })
      if (result.length === 0) throw new Error('Cabang tidak ditemukan')
    } else {
      await db
        .update(posSettings)
        .set({ receiptLogoKey: key, updatedAt: new Date() })
        .where(eq(posSettings.tenantId, auth.tenantId))
    }

    return { logoKey: key, branchId: data.branchId ?? null }
  })

/**
 * JUR-141 / JUR-145 PR 4 — Peti Kas tenant-level settings. Lets
 * the owner kill-switch the cash drawer (cash_drawer_enabled) and
 * tweak the variance threshold (cash_variance_threshold) used by
 * the TutupKasModal warning + report row highlight.
 *
 * Separate from updatePOSSettings because the kas settings are
 * Komplit-only — keeping them out of the shared payload keeps the
 * tier gating tight.
 */
export const updatePOSCashSettings = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      cashDrawerEnabled: z.boolean().optional(),
      cashVarianceThreshold: z
        .number()
        .int()
        .min(0)
        .max(100_000_000)
        .optional(),
      // #216 — tenant-default stale-session rule.
      cashStaleConfig: cashStaleConfigSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    if (auth.posTier !== 'komplit') {
      throw new Error('Peti Kas hanya tersedia di paket Komplit.')
    }
    const updateSet: Record<string, unknown> = { updatedAt: new Date() }
    if (data.cashDrawerEnabled !== undefined) {
      updateSet.cashDrawerEnabled = data.cashDrawerEnabled
    }
    if (data.cashVarianceThreshold !== undefined) {
      updateSet.cashVarianceThreshold = data.cashVarianceThreshold.toString()
    }
    if (data.cashStaleConfig !== undefined) {
      updateSet.cashStaleConfig = data.cashStaleConfig
    }
    await db
      .insert(posSettings)
      .values({
        tenantId: auth.tenantId,
        ...updateSet,
      } as typeof posSettings.$inferInsert)
      .onConflictDoUpdate({
        target: posSettings.tenantId,
        set: updateSet,
      })
    return { success: true as const }
  })

/**
 * #216 — per-branch stale-session override. Writes
 * `branches.cash_stale_config`. `null` clears the override → the branch
 * inherits the tenant default (pos_settings.cash_stale_config).
 * Komplit-only, branch-scoped like the other per-branch writers.
 */
export const updateBranchCashStaleConfig = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      /** A config object overrides; null reverts to the tenant default. */
      cashStaleConfig: cashStaleConfigSchema.nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    if (auth.posTier !== 'komplit') {
      throw new Error('Peti Kas hanya tersedia di paket Komplit.')
    }
    assertBranchAllowed(auth, data.branchId)
    const result = await db
      .update(branches)
      .set({ cashStaleConfig: data.cashStaleConfig, updatedAt: new Date() })
      .where(
        and(
          eq(branches.id, data.branchId),
          eq(branches.tenantId, auth.tenantId),
        ),
      )
      .returning({ id: branches.id })
    if (result.length === 0) throw new Error('Cabang tidak ditemukan')
    return { success: true as const }
  })

/**
 * Per-branch override for receipt footer + logo. Writes to the
 * branches table. Setting either field to null restores the tenant-
 * default fallback (see receipt renderer's COALESCE in pos-receipt.ts).
 *
 * Tenant-default values still live on pos_settings; updatePOSSettings
 * keeps editing those. This fn is for multi-outlet tenants who want a
 * per-branch address line / logo.
 */
export const updateBranchReceipt = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      /** undefined = leave column alone. null = clear (revert to tenant default). */
      receiptFooterText: z.string().max(500).optional().nullable(),
      receiptLogoKey: z.string().max(255).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'custom_receipt')
    // JUR-135: receipt-branding writes are scoped per-member too.
    // Owners pass through (null); restricted supervisors can only
    // edit branches they manage.
    assertBranchAllowed(auth, data.branchId)

    const updateSet: Record<string, unknown> = { updatedAt: new Date() }
    if (data.receiptFooterText !== undefined)
      updateSet.receiptFooterText = data.receiptFooterText
    if (data.receiptLogoKey !== undefined)
      updateSet.receiptLogoKey = data.receiptLogoKey

    const result = await db
      .update(branches)
      .set(updateSet)
      .where(
        and(
          eq(branches.id, data.branchId),
          eq(branches.tenantId, auth.tenantId),
        ),
      )
      .returning({ id: branches.id })
    if (result.length === 0) throw new Error('Cabang tidak ditemukan')

    return { success: true as const }
  })

export const getPOSReceiptLogoUrl = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ key: z.string() }))
  .handler(async ({ data }) => {
    await requirePOSAccess()
    const url = await getPOSLogoSignedUrl(data.key)
    return { url }
  })

/**
 * Today's operating hours for a branch. Reads `branch_schedules`
 * (the same table attendance uses for staff clock-in windows) and
 * compares against current Jakarta wall-clock to derive `isOpenNow`.
 *
 * Returns `null` when no schedule row exists for today's day-of-week —
 * the cashier UI treats that as "open by default" so brand-new tenants
 * who haven't configured branch hours yet aren't blocked.
 */
export const getPOSBranchHours = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    // JUR-135: branch hours are scoped per-member too. A restricted
    // cashier shouldn't be able to peek at hours for a branch they
    // can't sell on.
    assertBranchAllowed(auth, data.branchId)

    // Sanity: branch must belong to tenant.
    const [branch] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    const dow = jakartaDayOfWeek()
    const [schedule] = await db
      .select({
        isWorkDay: branchSchedules.isWorkDay,
        clockInTime: branchSchedules.clockInTime,
        clockOutTime: branchSchedules.clockOutTime,
      })
      .from(branchSchedules)
      .where(
        and(
          eq(branchSchedules.branchId, data.branchId),
          eq(branchSchedules.dayOfWeek, dow),
        ),
      )
      .limit(1)

    if (!schedule) {
      return {
        configured: false,
        isWorkDay: true,
        isOpenNow: true,
        clockInTime: null as string | null,
        clockOutTime: null as string | null,
      }
    }

    if (!schedule.isWorkDay) {
      return {
        configured: true,
        isWorkDay: false,
        isOpenNow: false,
        clockInTime: schedule.clockInTime ?? null,
        clockOutTime: schedule.clockOutTime ?? null,
      }
    }

    // Compare current Jakarta wall-clock HH:MM:SS against the schedule.
    const now = nowJakartaWallClock()
    const cur = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`
    const inT = schedule.clockInTime ?? '00:00:00'
    const outT = schedule.clockOutTime ?? '23:59:59'
    const isOpenNow = cur >= inT && cur <= outT

    return {
      configured: true,
      isWorkDay: true,
      isOpenNow,
      clockInTime: inT,
      clockOutTime: outT,
    }
  })

export const getPOSSettings = createServerFn().handler(async () => {
  const auth = await requirePOSAccess()
  const [settings] = await db
    .select()
    .from(posSettings)
    .where(eq(posSettings.tenantId, auth.tenantId))
    .limit(1)
  // Per-branch receipt overrides — settings page swaps between
  // tenant-default editing (pos_settings) and per-branch override
  // editing (branches.receipt_*). Tenants with a single branch never
  // see the dropdown; multi-branch tenants get a Default + per-branch
  // tab UI.
  const branchList = await db
    .select({
      id: branches.id,
      name: branches.name,
      receiptFooterText: branches.receiptFooterText,
      receiptLogoKey: branches.receiptLogoKey,
      cashStaleConfig: branches.cashStaleConfig,
    })
    .from(branches)
    .where(
      and(
        eq(branches.tenantId, auth.tenantId),
        eq(branches.isActive, true),
      ),
    )
    .orderBy(branches.createdAt)
  return {
    tier: auth.posTier,
    settings: settings ?? null,
    branches: branchList,
    limits: posTierLimits(auth.posTier),
  }
})

// ─── Loyalty (Komplit feature) ───────────────────────────────────────

/**
 * Cashier picker uses this to surface "Pelanggan punya 1.250 poin
 * (≈ Rp 12.500)" + the redeem checkbox. Returns a clean shape even
 * for customers with no balance row yet (lazy-insert pattern). The
 * customer detail page also calls this to populate the loyalty tab.
 */
export const getCustomerLoyaltySummary = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ customerId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'loyalty_points')

    // Tenant scoping: refuse to read another tenant's customer.
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, data.customerId),
          eq(customers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!customer) throw new Error('Pelanggan tidak ditemukan')

    const [bal] = await db
      .select({
        pointsBalance: customerLoyaltyBalances.pointsBalance,
        lifetimeEarned: customerLoyaltyBalances.lifetimeEarned,
        lifetimeRedeemed: customerLoyaltyBalances.lifetimeRedeemed,
      })
      .from(customerLoyaltyBalances)
      .where(eq(customerLoyaltyBalances.customerId, data.customerId))
      .limit(1)

    const movements = await db
      .select({
        id: customerLoyaltyMovements.id,
        type: customerLoyaltyMovements.type,
        points: customerLoyaltyMovements.points,
        saleId: customerLoyaltyMovements.saleId,
        reason: customerLoyaltyMovements.reason,
        performedBy: customerLoyaltyMovements.performedBy,
        createdAt: customerLoyaltyMovements.createdAt,
      })
      .from(customerLoyaltyMovements)
      .where(eq(customerLoyaltyMovements.customerId, data.customerId))
      .orderBy(desc(customerLoyaltyMovements.createdAt))
      .limit(50)

    return {
      pointsBalance: Number(bal?.pointsBalance ?? 0),
      lifetimeEarned: Number(bal?.lifetimeEarned ?? 0),
      lifetimeRedeemed: Number(bal?.lifetimeRedeemed ?? 0),
      movements: movements.map((m) => ({
        ...m,
        points: Number(m.points),
      })),
    }
  })

/**
 * Admin override — bumps a customer's points up or down by a signed
 * amount (positive = grant, negative = revoke). Writes a single
 * 'adjust' ledger row + bumps the balance. Requires `pos.manage` so
 * the cashier can't grant themselves points.
 */
const adjustLoyaltyInput = z.object({
  customerId: z.string().uuid(),
  /** Signed delta. Positive grants points; negative revokes. */
  points: z.coerce.number().int().refine((n) => n !== 0, 'Jumlah poin tidak boleh 0'),
  reason: z
    .string()
    .min(1, 'Alasan wajib diisi')
    .max(200, 'Alasan terlalu panjang'),
})

export const adjustLoyaltyPoints = createServerFn({ method: 'POST' })
  .inputValidator(adjustLoyaltyInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertPOSFeatureAvailable(auth.posTier, 'loyalty_points')
    if (!auth.permissions.includes('pos.manage')) {
      throw new Error('Hanya pemilik/admin yang bisa atur poin manual.')
    }

    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, data.customerId),
          eq(customers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!customer) throw new Error('Pelanggan tidak ditemukan')

    const now = new Date()
    const absPoints = Math.abs(data.points)
    const isGrant = data.points > 0

    await db.transaction(async (tx) => {
      // For revokes, refuse to push the balance below 0.
      if (!isGrant) {
        const [bal] = await tx
          .select({ pointsBalance: customerLoyaltyBalances.pointsBalance })
          .from(customerLoyaltyBalances)
          .where(eq(customerLoyaltyBalances.customerId, data.customerId))
          .limit(1)
        const current = Number(bal?.pointsBalance ?? 0)
        if (absPoints > current) {
          throw new Error(
            `Saldo tidak cukup. Saldo saat ini: ${current.toLocaleString('id-ID')}.`,
          )
        }
      }

      await tx.insert(customerLoyaltyMovements).values({
        tenantId: auth.tenantId,
        customerId: data.customerId,
        type: 'adjust',
        points: absPoints.toString(),
        reason: data.reason,
        performedBy: auth.userId,
      })

      // Balance upsert: positive delta on grant, negative on revoke.
      const delta = isGrant ? absPoints : -absPoints
      await tx
        .insert(customerLoyaltyBalances)
        .values({
          tenantId: auth.tenantId,
          customerId: data.customerId,
          pointsBalance: delta.toString(),
          // Grants count as lifetime-earned so the customer's "ever
          // earned" number on their detail page reflects manual gifts.
          // Revokes do NOT touch lifetime_redeemed (those are real
          // sale-driven redeems); leave it untouched.
          lifetimeEarned: (isGrant ? absPoints : 0).toString(),
        })
        .onConflictDoUpdate({
          target: customerLoyaltyBalances.customerId,
          set: {
            pointsBalance: sql`GREATEST(0, ${customerLoyaltyBalances.pointsBalance} + ${delta})`,
            lifetimeEarned: isGrant
              ? sql`${customerLoyaltyBalances.lifetimeEarned} + ${absPoints}`
              : customerLoyaltyBalances.lifetimeEarned,
            updatedAt: now,
          },
        })
    })

    return { success: true as const }
  })
