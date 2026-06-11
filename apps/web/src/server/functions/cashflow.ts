/**
 * Cashflow Monitoring Phase 1 (JUR-155) — manual income/expense ledger.
 *
 * Every function gates on `requireCashflowAccess()` (Komplit feature +
 * `pos.read`). `getCashflowOverview` is the one exception: it resolves
 * access without throwing so the route loader can render a friendly
 * upgrade gate instead of an error boundary.
 *
 * Phase 1 only ever writes `source = 'manual'` rows. POS auto-import
 * (Phase 2) writes `source = 'pos_sale'` rows; the mutations here refuse
 * to edit or delete anything that isn't manual.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  cashflowCategories,
  cashflowEntries,
  cashflowAccounts,
  branches,
  posSales,
} from '@vintra/db/schema'
import { posTierLimits } from '@vintra/shared'
import { and, eq, ne, or, isNull, gte, lte, desc, count, sql } from 'drizzle-orm'
import {
  requireCashflowAccess,
  requirePOSAccess,
} from '../middleware/module-access'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import {
  assertBranchAllowed,
  filterBranchesByAccess,
  branchScopeWhere,
} from '../lib/branch-scope'
import {
  getPenjualanCategoryId,
  cashflowDateKey,
  getDefaultAccountId,
} from '../lib/cashflow-sync'
import type { POSAccessContext } from '../middleware/module-access'

const PAGE_SIZE = 30
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ─── Access overview (non-throwing — drives the route gate) ──────────

export const getCashflowOverview = createServerFn().handler(async () => {
  const auth = await requirePOSAccess()
  const hasFeature = posTierLimits(auth.posTier).features.includes('cashflow')
  const hasPerm = auth.permissions.includes('pos.read')
  return { hasAccess: hasFeature && hasPerm }
})

// ─── Categories ──────────────────────────────────────────────────────

export const listCashflowCategories = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  const rows = await db
    .select({
      id: cashflowCategories.id,
      tenantId: cashflowCategories.tenantId,
      name: cashflowCategories.name,
      kind: cashflowCategories.kind,
      isSystem: cashflowCategories.isSystem,
    })
    .from(cashflowCategories)
    .where(
      or(
        isNull(cashflowCategories.tenantId),
        eq(cashflowCategories.tenantId, auth.tenantId),
      ),
    )
    .orderBy(
      cashflowCategories.kind,
      cashflowCategories.sortOrder,
      cashflowCategories.name,
    )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as 'income' | 'expense',
    isSystem: r.isSystem,
  }))
})

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nama kategori wajib diisi').max(60),
  kind: z.enum(['income', 'expense']),
})

export const createCashflowCategory = createServerFn({ method: 'POST' })
  .inputValidator(createCategorySchema)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    try {
      const [row] = await db
        .insert(cashflowCategories)
        .values({
          tenantId: auth.tenantId,
          name: data.name,
          kind: data.kind,
          isSystem: false,
          sortOrder: 100,
        })
        .returning({ id: cashflowCategories.id })
      return { id: row!.id }
    } catch {
      // Partial unique index (tenant_id, kind, name) — duplicate name.
      throw new Error('Kategori dengan nama itu sudah ada.')
    }
  })

const updateCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Nama kategori wajib diisi').max(60),
})

export const updateCashflowCategory = createServerFn({ method: 'POST' })
  .inputValidator(updateCategorySchema)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [existing] = await db
      .select({
        id: cashflowCategories.id,
        tenantId: cashflowCategories.tenantId,
        isSystem: cashflowCategories.isSystem,
      })
      .from(cashflowCategories)
      .where(eq(cashflowCategories.id, data.id))
      .limit(1)
    if (!existing || existing.tenantId !== auth.tenantId || existing.isSystem) {
      throw new Error('Kategori tidak bisa diubah.')
    }
    try {
      await db
        .update(cashflowCategories)
        .set({ name: data.name })
        .where(eq(cashflowCategories.id, data.id))
    } catch {
      throw new Error('Kategori dengan nama itu sudah ada.')
    }
    return { ok: true }
  })

export const deleteCashflowCategory = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [existing] = await db
      .select({
        id: cashflowCategories.id,
        tenantId: cashflowCategories.tenantId,
        isSystem: cashflowCategories.isSystem,
      })
      .from(cashflowCategories)
      .where(eq(cashflowCategories.id, data.id))
      .limit(1)
    if (!existing || existing.tenantId !== auth.tenantId || existing.isSystem) {
      throw new Error('Kategori sistem tidak bisa dihapus.')
    }
    const [used] = await db
      .select({ c: count() })
      .from(cashflowEntries)
      .where(eq(cashflowEntries.categoryId, data.id))
    if ((used?.c ?? 0) > 0) {
      throw new Error(
        'Kategori masih dipakai oleh catatan kas. Ganti ke kategori lain dulu sebelum menghapus.',
      )
    }
    await db.delete(cashflowCategories).where(eq(cashflowCategories.id, data.id))
    return { ok: true }
  })

// ─── Branches (for the entry form's optional branch picker) ──────────

export const listCashflowBranches = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  const rows = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)))
    .orderBy(branches.name)
  return filterBranchesByAccess(auth, rows)
})

// ─── Entries ─────────────────────────────────────────────────────────

async function loadCategoryForKind(
  auth: POSAccessContext,
  categoryId: string,
  kind: 'income' | 'expense',
) {
  const [cat] = await db
    .select({
      id: cashflowCategories.id,
      tenantId: cashflowCategories.tenantId,
      kind: cashflowCategories.kind,
    })
    .from(cashflowCategories)
    .where(eq(cashflowCategories.id, categoryId))
    .limit(1)
  if (!cat || (cat.tenantId !== null && cat.tenantId !== auth.tenantId)) {
    throw new Error('Kategori tidak ditemukan.')
  }
  if (cat.kind !== kind) {
    throw new Error('Kategori tidak sesuai dengan jenis transaksi.')
  }
}

/**
 * Franchisee scoping for a single entry: a branch-restricted caller
 * (outlet_owner) may only touch entries of a branch they run — never a
 * tenant-wide (null-branch) entry, never another branch's. Owner/admin
 * (allowedBranchIds === null) bypass.
 */
function assertEntryBranchInScope(
  auth: POSAccessContext,
  branchId: string | null,
): void {
  if (auth.allowedBranchIds === null) return
  if (branchId === null || !auth.allowedBranchIds.includes(branchId)) {
    throw new Error('Catatan ini di luar cabang yang Anda kelola.')
  }
}

async function resolveBranch(
  auth: POSAccessContext,
  branchId: string | null | undefined,
): Promise<string | null> {
  if (!branchId) return null
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.tenantId, auth.tenantId)))
    .limit(1)
  if (!b) throw new Error('Cabang tidak ditemukan.')
  assertBranchAllowed(auth, branchId)
  return branchId
}

/** Validate an account belongs to the tenant; fall back to the default. */
async function resolveAccount(
  auth: POSAccessContext,
  accountId: string | null | undefined,
): Promise<string> {
  if (!accountId) return getDefaultAccountId(auth.tenantId)
  const [a] = await db
    .select({ id: cashflowAccounts.id })
    .from(cashflowAccounts)
    .where(
      and(
        eq(cashflowAccounts.id, accountId),
        eq(cashflowAccounts.tenantId, auth.tenantId),
      ),
    )
    .limit(1)
  if (!a) throw new Error('Akun tidak ditemukan.')
  return accountId
}

const listEntriesSchema = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
  type: z.enum(['income', 'expense']).optional(),
  /** Topbar branch switcher — scope the ledger + totals to one outlet. */
  branchId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  // JUR-156: hide POS-imported rows so the owner can sanity-check the
  // manual side independently. Affects both the list and the totals.
  hidePos: z.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export const listCashflowEntries = createServerFn({ method: 'POST' })
  .inputValidator(listEntriesSchema)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()

    const rangeConds = [
      eq(cashflowEntries.tenantId, auth.tenantId),
      gte(cashflowEntries.date, data.from),
      lte(cashflowEntries.date, data.to),
    ]
    if (data.hidePos) {
      rangeConds.push(ne(cashflowEntries.source, 'pos_sale'))
    }
    if (data.branchId) {
      rangeConds.push(eq(cashflowEntries.branchId, data.branchId))
    }
    // Hard franchisee scope — a branch-restricted caller never sees
    // beyond their branches regardless of the branchId param above.
    const scopeCond = branchScopeWhere(auth, cashflowEntries.branchId)
    if (scopeCond) rangeConds.push(scopeCond)
    if (data.accountId) {
      rangeConds.push(eq(cashflowEntries.accountId, data.accountId))
    }
    const listConds = [...rangeConds]
    if (data.type) listConds.push(eq(cashflowEntries.type, data.type))
    if (data.categoryId)
      listConds.push(eq(cashflowEntries.categoryId, data.categoryId))
    const listWhere = and(...listConds)

    const [items, totalRow, agg] = await Promise.all([
      db
        .select({
          id: cashflowEntries.id,
          date: cashflowEntries.date,
          type: cashflowEntries.type,
          amount: cashflowEntries.amount,
          note: cashflowEntries.note,
          source: cashflowEntries.source,
          sourceRef: cashflowEntries.sourceRef,
          categoryId: cashflowEntries.categoryId,
          categoryName: cashflowCategories.name,
          accountId: cashflowEntries.accountId,
          accountName: cashflowAccounts.name,
          branchId: cashflowEntries.branchId,
          branchName: branches.name,
        })
        .from(cashflowEntries)
        .innerJoin(
          cashflowCategories,
          eq(cashflowCategories.id, cashflowEntries.categoryId),
        )
        .innerJoin(
          cashflowAccounts,
          eq(cashflowAccounts.id, cashflowEntries.accountId),
        )
        .leftJoin(branches, eq(branches.id, cashflowEntries.branchId))
        .where(listWhere)
        .orderBy(desc(cashflowEntries.date), desc(cashflowEntries.createdAt))
        .limit(PAGE_SIZE)
        .offset((data.page - 1) * PAGE_SIZE),
      db
        .select({ c: count() })
        .from(cashflowEntries)
        .where(listWhere),
      // Footer totals reflect the date range only — independent of the
      // active type/category filter — so the summary stays a stable
      // "this period" snapshot.
      db
        .select({
          income: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'income' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
          expense: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'expense' THEN ${cashflowEntries.amount} ELSE 0 END), 0)`,
        })
        .from(cashflowEntries)
        .where(and(...rangeConds)),
    ])

    const income = Number(agg[0]?.income ?? 0)
    const expense = Number(agg[0]?.expense ?? 0)

    return {
      items: items.map((r) => ({
        id: r.id,
        date: r.date,
        type: r.type as 'income' | 'expense',
        amount: Number(r.amount),
        note: r.note,
        source: r.source,
        sourceRef: r.sourceRef,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        accountId: r.accountId,
        accountName: r.accountName,
        branchId: r.branchId,
        branchName: r.branchName,
      })),
      total: totalRow[0]?.c ?? 0,
      page: data.page,
      pageSize: PAGE_SIZE,
      totals: { income, expense, net: income - expense },
    }
  })

const entryInputSchema = z.object({
  type: z.enum(['income', 'expense']),
  categoryId: z.string().uuid('Kategori wajib dipilih'),
  accountId: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive('Jumlah harus lebih dari 0'),
  date: z.string().regex(DATE_RE, 'Tanggal tidak valid'),
  branchId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
})

export const createCashflowEntry = createServerFn({ method: 'POST' })
  .inputValidator(entryInputSchema)
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    await loadCategoryForKind(auth, data.categoryId, data.type)
    const branchId = await resolveBranch(auth, data.branchId)
    // A branch-restricted caller must attribute the entry to their
    // branch — they can't create tenant-wide (null-branch) rows.
    if (auth.allowedBranchIds !== null && !branchId) {
      throw new Error('Pilih cabang untuk catatan arus kas ini.')
    }
    const accountId = await resolveAccount(auth, data.accountId)
    const [row] = await db
      .insert(cashflowEntries)
      .values({
        tenantId: auth.tenantId,
        branchId,
        accountId,
        type: data.type,
        categoryId: data.categoryId,
        amount: String(data.amount),
        date: data.date,
        source: 'manual',
        note: data.note ?? null,
        createdByUserId: auth.userId,
      })
      .returning({ id: cashflowEntries.id })
    return { id: row!.id }
  })

export const updateCashflowEntry = createServerFn({ method: 'POST' })
  .inputValidator(entryInputSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [existing] = await db
      .select({
        id: cashflowEntries.id,
        tenantId: cashflowEntries.tenantId,
        source: cashflowEntries.source,
        branchId: cashflowEntries.branchId,
      })
      .from(cashflowEntries)
      .where(eq(cashflowEntries.id, data.id))
      .limit(1)
    if (!existing || existing.tenantId !== auth.tenantId) {
      throw new Error('Catatan tidak ditemukan.')
    }
    assertEntryBranchInScope(auth, existing.branchId)
    if (existing.source !== 'manual') {
      throw new Error('Catatan otomatis (mis. dari POS) tidak bisa diubah.')
    }
    await loadCategoryForKind(auth, data.categoryId, data.type)
    const branchId = await resolveBranch(auth, data.branchId)
    const accountId = await resolveAccount(auth, data.accountId)
    await db
      .update(cashflowEntries)
      .set({
        branchId,
        accountId,
        type: data.type,
        categoryId: data.categoryId,
        amount: String(data.amount),
        date: data.date,
        note: data.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(cashflowEntries.id, data.id))
    return { ok: true }
  })

export const deleteCashflowEntry = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [existing] = await db
      .select({
        id: cashflowEntries.id,
        tenantId: cashflowEntries.tenantId,
        source: cashflowEntries.source,
        branchId: cashflowEntries.branchId,
      })
      .from(cashflowEntries)
      .where(eq(cashflowEntries.id, data.id))
      .limit(1)
    if (!existing || existing.tenantId !== auth.tenantId) {
      throw new Error('Catatan tidak ditemukan.')
    }
    assertEntryBranchInScope(auth, existing.branchId)
    if (existing.source !== 'manual') {
      throw new Error('Catatan otomatis (mis. dari POS) tidak bisa dihapus.')
    }
    await db.delete(cashflowEntries).where(eq(cashflowEntries.id, data.id))
    return { ok: true }
  })

// ─── POS backfill (JUR-156 — platform admin) ─────────────────────────

/**
 * Backfill cashflow income rows for a tenant's existing completed POS
 * sales. Idempotent — a sale that already has a linked `pos_sale` entry
 * is skipped via the NOT EXISTS guard. Used after a tenant upgrades to
 * Komplit so their sales history shows up in the ledger.
 */
export const backfillPosCashflowEntries = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const categoryId = await getPenjualanCategoryId()
    if (!categoryId) {
      throw new Error(
        'Kategori sistem "Penjualan" belum ada — jalankan migrasi cashflow dulu.',
      )
    }

    const sales = await db
      .select({
        id: posSales.id,
        branchId: posSales.branchId,
        total: posSales.total,
        createdAt: posSales.createdAt,
        cashierUserId: posSales.cashierUserId,
      })
      .from(posSales)
      .where(
        and(
          eq(posSales.tenantId, data.tenantId),
          eq(posSales.status, 'completed'),
          sql`NOT EXISTS (SELECT 1 FROM ${cashflowEntries} WHERE ${cashflowEntries.source} = 'pos_sale' AND ${cashflowEntries.sourceRef} = ${posSales.id})`,
        ),
      )

    if (sales.length === 0) return { inserted: 0, scanned: 0 }

    const accountId = await getDefaultAccountId(data.tenantId)
    await db.insert(cashflowEntries).values(
      sales.map((s) => ({
        tenantId: data.tenantId,
        branchId: s.branchId,
        accountId,
        type: 'income' as const,
        categoryId,
        amount: String(s.total),
        date: cashflowDateKey(new Date(s.createdAt)),
        source: 'pos_sale' as const,
        sourceRef: s.id,
        createdByUserId: s.cashierUserId,
      })),
    )
    return { inserted: sales.length, scanned: sales.length }
  })

// ─── Today summary (mobile home widget) ─────────────────────────────
//
// Aggregates income / expense totals for today (Jakarta TZ) so the
// mobile home screen's "Kas hari ini" widget can render a single
// number without paging the whole ledger.
//
// Branch scope: respects the caller's allowedBranchIds — outlet-owner
// franchisees only see their own outlet's totals. Tenant-wide rows
// (branchId IS NULL) only count for owner/admin (allowedBranchIds === null).
//
// Source filter: includes both manual entries AND pos_sale rows.
// Mobile users want the "real" cashflow, not just the manual side.

export const getCashflowTodaySummary = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()

  // cashflowDateKey converts a Date to YYYY-MM-DD in Jakarta time;
  // calling with `new Date()` gives us "today" for the user's locale.
  const today = cashflowDateKey(new Date())

  const branchFilter =
    auth.allowedBranchIds === null
      ? sql``
      : sql`AND ${cashflowEntries.branchId} IN ${sql.raw(`(${auth.allowedBranchIds.map((id) => `'${id}'`).join(',')})`)}`

  const rows = await db.execute<{ type: 'income' | 'expense'; total: string }>(
    sql`
      SELECT ${cashflowEntries.type} AS type,
             COALESCE(SUM(${cashflowEntries.amount}), 0)::numeric AS total
      FROM ${cashflowEntries}
      WHERE ${cashflowEntries.tenantId} = ${auth.tenantId}
        AND ${cashflowEntries.date} = ${today}
        ${branchFilter}
      GROUP BY ${cashflowEntries.type}
    `,
  )

  let income = 0
  let expense = 0
  for (const row of rows) {
    const amt = Number(row.total)
    if (row.type === 'income') income = amt
    else if (row.type === 'expense') expense = amt
  }

  return {
    date: today,
    income,
    expense,
    net: income - expense,
  }
})
