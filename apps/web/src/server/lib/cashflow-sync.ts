/**
 * Cashflow ↔ POS sync helpers (JUR-156).
 *
 * A completed POS sale is mirrored into the cashflow ledger as an
 * `income` row with `source = 'pos_sale'` and `source_ref = sale.id`.
 * Voiding a sale drops that row so the ledger's net stays correct.
 * The same writer backs the admin backfill of historical sales.
 */
import { db } from '@vintra/db'
import {
  cashflowCategories,
  cashflowEntries,
  cashflowAccounts,
} from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'

// The "Penjualan" system category is a fixed seed (migration 0077) —
// cache its id process-wide after the first lookup.
let penjualanCategoryIdCache: string | null = null

export async function getPenjualanCategoryId(): Promise<string | null> {
  if (penjualanCategoryIdCache) return penjualanCategoryIdCache
  const [row] = await db
    .select({ id: cashflowCategories.id })
    .from(cashflowCategories)
    .where(
      and(
        eq(cashflowCategories.name, 'Penjualan'),
        eq(cashflowCategories.kind, 'income'),
        eq(cashflowCategories.isSystem, true),
      ),
    )
    .limit(1)
  penjualanCategoryIdCache = row?.id ?? null
  return penjualanCategoryIdCache
}

// Generic system-category lookup, cached per (kind, name).
const systemCategoryCache = new Map<string, string | null>()

export async function getSystemCategoryId(
  name: string,
  kind: 'income' | 'expense',
): Promise<string | null> {
  const key = `${kind}:${name}`
  const cached = systemCategoryCache.get(key)
  if (cached !== undefined) return cached
  const [row] = await db
    .select({ id: cashflowCategories.id })
    .from(cashflowCategories)
    .where(
      and(
        eq(cashflowCategories.name, name),
        eq(cashflowCategories.kind, kind),
        eq(cashflowCategories.isSystem, true),
      ),
    )
    .limit(1)
  const id = row?.id ?? null
  systemCategoryCache.set(key, id)
  return id
}

// The default cashflow account id, cached per tenant (JUR-192). The id
// is stable for a tenant's lifetime once created.
const defaultAccountCache = new Map<string, string>()

/**
 * Resolve a tenant's default cashflow account, creating it if missing
 * (covers tenants registered after migration 0080). Every
 * `cashflow_entries` writer routes through this when no explicit
 * account is chosen.
 */
export async function getDefaultAccountId(tenantId: string): Promise<string> {
  const cached = defaultAccountCache.get(tenantId)
  if (cached) return cached
  await db
    .insert(cashflowAccounts)
    .values({ tenantId, name: 'Kas Utama', kind: 'cash', isDefault: true })
    .onConflictDoNothing()
  const [row] = await db
    .select({ id: cashflowAccounts.id })
    .from(cashflowAccounts)
    .where(
      and(
        eq(cashflowAccounts.tenantId, tenantId),
        eq(cashflowAccounts.isDefault, true),
      ),
    )
    .limit(1)
  if (!row) throw new Error('Akun kas default tidak ditemukan.')
  defaultAccountCache.set(tenantId, row.id)
  return row.id
}

/** Jakarta-local YYYY-MM-DD for a given instant. */
export function cashflowDateKey(d: Date): string {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Mirror a completed POS sale into the cashflow ledger. No-op when the
 * Penjualan system category is missing. `exec` is the sale's tx (or db)
 * so the write shares the sale's transaction.
 */
export async function writePosSaleCashflowEntry(
  exec: typeof db,
  input: {
    tenantId: string
    saleId: string
    branchId: string | null
    amount: string | number
    occurredAt: Date
    createdByUserId: string
  },
): Promise<void> {
  const categoryId = await getPenjualanCategoryId()
  if (!categoryId) return
  const accountId = await getDefaultAccountId(input.tenantId)
  await exec.insert(cashflowEntries).values({
    tenantId: input.tenantId,
    branchId: input.branchId,
    accountId,
    type: 'income',
    categoryId,
    amount: String(input.amount),
    date: cashflowDateKey(input.occurredAt),
    source: 'pos_sale',
    sourceRef: input.saleId,
    createdByUserId: input.createdByUserId,
  })
}

/**
 * Resolve the cashflow category for a Tarik Tunai (cash payout). When the
 * cashier picked a category we validate it's an in-scope `expense` row
 * (tenant-owned or shared system); anything invalid or out-of-scope falls
 * back to the "Pengeluaran Kas" system category so the payout still books
 * correctly rather than failing on a stale id. Returns null only when the
 * system category is missing (migration 0117 not yet run) — the caller
 * treats that as "skip the cashflow write".
 */
export async function resolveCashPayoutCategoryId(
  tenantId: string,
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (categoryId) {
    const [cat] = await db
      .select({
        id: cashflowCategories.id,
        tenantId: cashflowCategories.tenantId,
        kind: cashflowCategories.kind,
      })
      .from(cashflowCategories)
      .where(eq(cashflowCategories.id, categoryId))
      .limit(1)
    if (
      cat &&
      cat.kind === 'expense' &&
      (cat.tenantId === null || cat.tenantId === tenantId)
    ) {
      return cat.id
    }
  }
  return getSystemCategoryId('Pengeluaran Kas', 'expense')
}

/**
 * Mirror a Tarik Tunai (cash payout) into the cashflow ledger as an
 * `expense` row with `source = 'pos_cash_payout'` and `source_ref =
 * movementId`. Keeps the drawer ledger and the books in sync from a
 * single cashier action — symmetric to writePosSaleCashflowEntry for
 * sales. `exec` is the payout's tx so the write shares its atomicity.
 * No-op when the system category is missing.
 */
export async function writeCashPayoutCashflowEntry(
  exec: typeof db,
  input: {
    tenantId: string
    movementId: string
    branchId: string | null
    amount: string | number
    reason: string | null
    categoryId?: string | null
    occurredAt: Date
    createdByUserId: string
  },
): Promise<void> {
  const categoryId = await resolveCashPayoutCategoryId(
    input.tenantId,
    input.categoryId,
  )
  if (!categoryId) return
  const accountId = await getDefaultAccountId(input.tenantId)
  await exec.insert(cashflowEntries).values({
    tenantId: input.tenantId,
    branchId: input.branchId,
    accountId,
    type: 'expense',
    categoryId,
    amount: String(input.amount),
    date: cashflowDateKey(input.occurredAt),
    source: 'pos_cash_payout',
    sourceRef: input.movementId,
    note: input.reason,
    createdByUserId: input.createdByUserId,
  })
}

/**
 * Mirror a fulfilled franchise stock requisition into the cashflow
 * ledger as a paired entry: an `expense` on the requesting (franchise)
 * branch and a matching `income` on HQ (the source branch). Both carry
 * `source = 'stock_requisition'` + `source_ref = requisitionId`.
 *
 * No-op when `amount <= 0` (an independent transfer carries no price)
 * or when the system categories are missing. `exec` is the fulfilment
 * tx so the writes share its atomicity.
 */
export async function writeRequisitionCashflowEntries(
  exec: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    tenantId: string
    requisitionId: string
    requisitionNumber: string
    /** Franchise outlet that ordered — the expense side. */
    requestingBranchId: string
    /** HQ / main branch that fulfilled — the income side. */
    sourceBranchId: string
    amount: string | number
    occurredAt: Date
    createdByUserId: string
  },
): Promise<void> {
  const amt = Number(input.amount)
  if (!(amt > 0)) return
  const [expenseCatId, incomeCatId] = await Promise.all([
    getSystemCategoryId('Pembelian Stok dari Pusat', 'expense'),
    getSystemCategoryId('Penjualan Stok ke Outlet', 'income'),
  ])
  if (!expenseCatId || !incomeCatId) return
  const accountId = await getDefaultAccountId(input.tenantId)
  const date = cashflowDateKey(input.occurredAt)
  await exec.insert(cashflowEntries).values([
    {
      tenantId: input.tenantId,
      branchId: input.requestingBranchId,
      accountId,
      type: 'expense',
      categoryId: expenseCatId,
      amount: String(amt),
      date,
      source: 'stock_requisition',
      sourceRef: input.requisitionId,
      note: `Pembelian stok ${input.requisitionNumber} dari pusat`,
      createdByUserId: input.createdByUserId,
    },
    {
      tenantId: input.tenantId,
      branchId: input.sourceBranchId,
      accountId,
      type: 'income',
      categoryId: incomeCatId,
      amount: String(amt),
      date,
      source: 'stock_requisition',
      sourceRef: input.requisitionId,
      note: `Penjualan stok ${input.requisitionNumber} ke outlet`,
      createdByUserId: input.createdByUserId,
    },
  ])
}

/** Drop the cashflow row(s) linked to a POS sale (on void). */
export async function removePosSaleCashflowEntry(
  exec: typeof db,
  input: { tenantId: string; saleId: string },
): Promise<void> {
  await exec
    .delete(cashflowEntries)
    .where(
      and(
        eq(cashflowEntries.tenantId, input.tenantId),
        eq(cashflowEntries.source, 'pos_sale'),
        eq(cashflowEntries.sourceRef, input.saleId),
      ),
    )
}
