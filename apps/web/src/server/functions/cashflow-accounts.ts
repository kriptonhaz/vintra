/**
 * Akun Kas & Bank (JUR-192) — account CRUD, per-account balances, and
 * transfers between a tenant's own accounts.
 *
 * A transfer is deliberately NOT a `cashflow_entries` row — it lives in
 * `cashflow_transfers` and never touches income/expense, so the P&L is
 * unaffected. Account balances read transfers directly.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  cashflowAccounts,
  cashflowEntries,
  cashflowTransfers,
} from '@vintra/db/schema'
import { and, eq, count, sql, asc, desc, or } from 'drizzle-orm'
import { requireCashflowAccess } from '../middleware/module-access'
import { getDefaultAccountId } from '../lib/cashflow-sync'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ACCOUNT_KINDS = ['cash', 'bank', 'ewallet', 'other'] as const

// ─── List accounts (with computed balances) ──────────────────────────

export const listCashflowAccounts = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  // Ensure the default account exists before listing.
  await getDefaultAccountId(auth.tenantId)

  const [accounts, entryAgg, transferAgg] = await Promise.all([
    db
      .select()
      .from(cashflowAccounts)
      .where(eq(cashflowAccounts.tenantId, auth.tenantId))
      .orderBy(
        desc(cashflowAccounts.isDefault),
        asc(cashflowAccounts.sortOrder),
        asc(cashflowAccounts.name),
      ),
    db
      .select({
        accountId: cashflowEntries.accountId,
        net: sql<string>`COALESCE(SUM(CASE WHEN ${cashflowEntries.type} = 'income' THEN ${cashflowEntries.amount} ELSE -${cashflowEntries.amount} END), 0)`,
      })
      .from(cashflowEntries)
      .where(eq(cashflowEntries.tenantId, auth.tenantId))
      .groupBy(cashflowEntries.accountId),
    db
      .select({
        fromAccountId: cashflowTransfers.fromAccountId,
        toAccountId: cashflowTransfers.toAccountId,
        amount: cashflowTransfers.amount,
      })
      .from(cashflowTransfers)
      .where(eq(cashflowTransfers.tenantId, auth.tenantId)),
  ])

  const netByAccount = new Map<string, number>()
  for (const r of entryAgg) netByAccount.set(r.accountId, Number(r.net))
  const transferDelta = new Map<string, number>()
  for (const t of transferAgg) {
    const amt = Number(t.amount)
    transferDelta.set(
      t.fromAccountId,
      (transferDelta.get(t.fromAccountId) ?? 0) - amt,
    )
    transferDelta.set(
      t.toAccountId,
      (transferDelta.get(t.toAccountId) ?? 0) + amt,
    )
  }

  return accounts.map((a) => {
    const opening = Number(a.openingBalance)
    const net = netByAccount.get(a.id) ?? 0
    const transfers = transferDelta.get(a.id) ?? 0
    return {
      id: a.id,
      name: a.name,
      kind: a.kind as (typeof ACCOUNT_KINDS)[number],
      openingBalance: opening,
      isDefault: a.isDefault,
      isActive: a.isActive,
      balance: opening + net + transfers,
    }
  })
})

// ─── Create / update / delete account ────────────────────────────────

export const createCashflowAccount = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().trim().min(1, 'Nama akun wajib diisi').max(60),
      kind: z.enum(ACCOUNT_KINDS),
      openingBalance: z.coerce.number().default(0),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [row] = await db
      .insert(cashflowAccounts)
      .values({
        tenantId: auth.tenantId,
        name: data.name,
        kind: data.kind,
        openingBalance: String(data.openingBalance),
        isDefault: false,
        sortOrder: 100,
      })
      .returning({ id: cashflowAccounts.id })
    return { id: row!.id }
  })

export const updateCashflowAccount = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1, 'Nama akun wajib diisi').max(60),
      kind: z.enum(ACCOUNT_KINDS),
      openingBalance: z.coerce.number(),
      isActive: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [existing] = await db
      .select({ id: cashflowAccounts.id, isDefault: cashflowAccounts.isDefault })
      .from(cashflowAccounts)
      .where(
        and(
          eq(cashflowAccounts.id, data.id),
          eq(cashflowAccounts.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!existing) throw new Error('Akun tidak ditemukan.')
    // The default account can be renamed but never deactivated.
    await db
      .update(cashflowAccounts)
      .set({
        name: data.name,
        kind: data.kind,
        openingBalance: String(data.openingBalance),
        isActive: existing.isDefault ? true : data.isActive,
        updatedAt: new Date(),
      })
      .where(eq(cashflowAccounts.id, data.id))
    return { ok: true }
  })

export const deleteCashflowAccount = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [existing] = await db
      .select({ id: cashflowAccounts.id, isDefault: cashflowAccounts.isDefault })
      .from(cashflowAccounts)
      .where(
        and(
          eq(cashflowAccounts.id, data.id),
          eq(cashflowAccounts.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!existing) throw new Error('Akun tidak ditemukan.')
    if (existing.isDefault) {
      throw new Error('Akun utama tidak bisa dihapus.')
    }
    const [entryUse] = await db
      .select({ c: count() })
      .from(cashflowEntries)
      .where(eq(cashflowEntries.accountId, data.id))
    const [transferUse] = await db
      .select({ c: count() })
      .from(cashflowTransfers)
      .where(
        or(
          eq(cashflowTransfers.fromAccountId, data.id),
          eq(cashflowTransfers.toAccountId, data.id),
        ),
      )
    if ((entryUse?.c ?? 0) > 0 || (transferUse?.c ?? 0) > 0) {
      throw new Error(
        'Akun masih punya transaksi. Nonaktifkan saja akun ini daripada menghapusnya.',
      )
    }
    await db.delete(cashflowAccounts).where(eq(cashflowAccounts.id, data.id))
    return { ok: true }
  })

// ─── Transfers ───────────────────────────────────────────────────────

export const listCashflowTransfers = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  const rows = await db.execute<{
    id: string
    amount: string
    date: string
    note: string | null
    created_at: string
    from_name: string
    to_name: string
  }>(sql`
    SELECT t.id, t.amount, t.date, t.note, t.created_at,
           f.name AS from_name, x.name AS to_name
    FROM cashflow_transfers t
    JOIN cashflow_accounts f ON f.id = t.from_account_id
    JOIN cashflow_accounts x ON x.id = t.to_account_id
    WHERE t.tenant_id = ${auth.tenantId}
    ORDER BY t.date DESC, t.created_at DESC
    LIMIT 50
  `)
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    date: r.date,
    note: r.note,
    fromName: r.from_name,
    toName: r.to_name,
  }))
})

export const createCashflowTransfer = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fromAccountId: z.string().uuid('Akun asal wajib dipilih'),
      toAccountId: z.string().uuid('Akun tujuan wajib dipilih'),
      amount: z.coerce.number().positive('Jumlah harus lebih dari 0'),
      date: z.string().regex(DATE_RE, 'Tanggal tidak valid'),
      note: z.string().trim().max(500).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    if (data.fromAccountId === data.toAccountId) {
      throw new Error('Akun asal dan tujuan harus berbeda.')
    }
    const accounts = await db
      .select({ id: cashflowAccounts.id })
      .from(cashflowAccounts)
      .where(eq(cashflowAccounts.tenantId, auth.tenantId))
    const ids = new Set(accounts.map((a) => a.id))
    if (!ids.has(data.fromAccountId) || !ids.has(data.toAccountId)) {
      throw new Error('Akun tidak ditemukan.')
    }
    const [row] = await db
      .insert(cashflowTransfers)
      .values({
        tenantId: auth.tenantId,
        fromAccountId: data.fromAccountId,
        toAccountId: data.toAccountId,
        amount: String(data.amount),
        date: data.date,
        note: data.note ?? null,
        createdByUserId: auth.userId,
      })
      .returning({ id: cashflowTransfers.id })
    return { id: row!.id }
  })
