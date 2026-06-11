/**
 * Bon Pelanggan / accounts receivable (JUR-157).
 *
 * Manual bon entry + partial-payment collection. Recording a payment
 * also posts a cashflow income row (`source = 'ar_payment'`) so the
 * ledger reflects money actually collected, not the original credit.
 *
 * The POS auto-create path (under-paid sale → AR row) is deferred until
 * the cashier supports credit sales; `createReceivable` is the building
 * block that path will reuse.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  arReceivables,
  arPayments,
  cashflowEntries,
  customers,
} from '@vintra/db/schema'
import { and, eq, desc, sql, inArray } from 'drizzle-orm'
import { posTierLimits } from '@vintra/shared'
import {
  requireCashflowAccess,
  requirePOSAccess,
} from '../middleware/module-access'
import {
  getPenjualanCategoryId,
  cashflowDateKey,
  getDefaultAccountId,
} from '../lib/cashflow-sync'

type Bucket = 'lancar' | 't30' | 't60' | 't90'

/** Whole days between a YYYY-MM-DD reference and today (Jakarta). */
function ageInDays(refDate: string): number {
  const ref = new Date(`${refDate}T00:00:00Z`).getTime()
  const today = new Date(
    `${cashflowDateKey(new Date())}T00:00:00Z`,
  ).getTime()
  return Math.floor((today - ref) / 86_400_000)
}

function bucketFor(age: number): Bucket {
  if (age <= 30) return 'lancar'
  if (age <= 60) return 't30'
  if (age <= 90) return 't60'
  return 't90'
}

// ─── Customer options (bon form picker) ──────────────────────────────

export const listArCustomerOptions = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
    })
    .from(customers)
    .where(eq(customers.tenantId, auth.tenantId))
    .orderBy(customers.name)
  return rows
})

// ─── List + aging ────────────────────────────────────────────────────

export const listReceivables = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  const rows = await db
    .select({
      id: arReceivables.id,
      customerId: arReceivables.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      saleId: arReceivables.saleId,
      amount: arReceivables.amount,
      paidAmount: arReceivables.paidAmount,
      status: arReceivables.status,
      dueDate: arReceivables.dueDate,
      note: arReceivables.note,
      createdAt: arReceivables.createdAt,
    })
    .from(arReceivables)
    .innerJoin(customers, eq(customers.id, arReceivables.customerId))
    .where(eq(arReceivables.tenantId, auth.tenantId))
    .orderBy(desc(arReceivables.createdAt))

  const summary: Record<Bucket, { count: number; total: number }> = {
    lancar: { count: 0, total: 0 },
    t30: { count: 0, total: 0 },
    t60: { count: 0, total: 0 },
    t90: { count: 0, total: 0 },
  }

  const items = rows.map((r) => {
    const amount = Number(r.amount)
    const paidAmount = Number(r.paidAmount)
    const outstanding = Math.max(0, amount - paidAmount)
    const settled = r.status === 'paid' || r.status === 'written_off'
    const refDate = r.dueDate ?? cashflowDateKey(new Date(r.createdAt))
    const age = ageInDays(refDate)
    const bucket: Bucket | null = settled ? null : bucketFor(age)
    if (bucket) {
      summary[bucket].count += 1
      summary[bucket].total += outstanding
    }
    return {
      id: r.id,
      customerId: r.customerId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      saleId: r.saleId,
      amount,
      paidAmount,
      outstanding,
      status: r.status as 'outstanding' | 'partial' | 'paid' | 'written_off',
      dueDate: r.dueDate,
      note: r.note,
      createdAt: r.createdAt,
      ageDays: age,
      bucket,
    }
  })

  const totalOutstanding =
    summary.lancar.total +
    summary.t30.total +
    summary.t60.total +
    summary.t90.total

  return { items, summary, totalOutstanding }
})

export const getReceivablePayments = createServerFn()
  .inputValidator(z.object({ receivableId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [rec] = await db
      .select({ id: arReceivables.id, tenantId: arReceivables.tenantId })
      .from(arReceivables)
      .where(eq(arReceivables.id, data.receivableId))
      .limit(1)
    if (!rec || rec.tenantId !== auth.tenantId) {
      throw new Error('Bon tidak ditemukan.')
    }
    const rows = await db
      .select({
        id: arPayments.id,
        amount: arPayments.amount,
        method: arPayments.method,
        note: arPayments.note,
        paidAt: arPayments.paidAt,
      })
      .from(arPayments)
      .where(eq(arPayments.receivableId, data.receivableId))
      .orderBy(desc(arPayments.paidAt))
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  })

// ─── Create (manual bon) ─────────────────────────────────────────────

export const createReceivable = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      customerId: z.string().uuid('Pelanggan wajib dipilih'),
      amount: z.coerce.number().positive('Jumlah harus lebih dari 0'),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .nullable(),
      note: z.string().trim().max(500).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
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
    if (!customer) throw new Error('Pelanggan tidak ditemukan.')
    const [row] = await db
      .insert(arReceivables)
      .values({
        tenantId: auth.tenantId,
        customerId: data.customerId,
        amount: String(data.amount),
        status: 'outstanding',
        dueDate: data.dueDate ?? null,
        note: data.note ?? null,
      })
      .returning({ id: arReceivables.id })
    return { id: row!.id }
  })

// ─── Record a payment ────────────────────────────────────────────────

export const recordArPayment = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      receivableId: z.string().uuid(),
      amount: z.coerce.number().positive('Jumlah harus lebih dari 0'),
      method: z.enum(['cash', 'transfer', 'qris', 'other']),
      note: z.string().trim().max(500).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [rec] = await db
      .select()
      .from(arReceivables)
      .where(eq(arReceivables.id, data.receivableId))
      .limit(1)
    if (!rec || rec.tenantId !== auth.tenantId) {
      throw new Error('Bon tidak ditemukan.')
    }
    if (rec.status === 'paid' || rec.status === 'written_off') {
      throw new Error('Bon ini sudah lunas.')
    }
    const amount = Number(rec.amount)
    const paidBefore = Number(rec.paidAmount)
    const outstanding = amount - paidBefore
    if (data.amount > outstanding + 0.001) {
      throw new Error(
        `Pembayaran melebihi sisa bon (sisa Rp ${outstanding.toLocaleString('id-ID')}).`,
      )
    }
    const paidAfter = paidBefore + data.amount
    const fullyPaid = paidAfter >= amount - 0.001

    const categoryId = await getPenjualanCategoryId()
    if (!categoryId) {
      throw new Error('Kategori sistem "Penjualan" belum ada.')
    }
    const accountId = await getDefaultAccountId(auth.tenantId)
    const now = new Date()

    await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(arPayments)
        .values({
          receivableId: rec.id,
          amount: String(data.amount),
          method: data.method,
          note: data.note ?? null,
          recordedByUserId: auth.userId,
        })
        .returning({ id: arPayments.id })

      await tx
        .update(arReceivables)
        .set({
          paidAmount: String(paidAfter),
          status: fullyPaid ? 'paid' : 'partial',
          paidAt: fullyPaid ? now : rec.paidAt,
          updatedAt: now,
        })
        .where(eq(arReceivables.id, rec.id))

      // Cashflow ledger: a collected bon is income realised now.
      await tx.insert(cashflowEntries).values({
        tenantId: auth.tenantId,
        accountId,
        type: 'income',
        categoryId,
        amount: String(data.amount),
        date: cashflowDateKey(now),
        source: 'ar_payment',
        sourceRef: payment!.id,
        note: `Pembayaran bon ${rec.id.slice(0, 8)}`,
        createdByUserId: auth.userId,
      })
    })
    return { ok: true, fullyPaid }
  })

// ─── Customer kasbon balance (cashier surface, JUR-191) ──────────────

/**
 * Outstanding kasbon for one customer — drives the cashier's payment
 * modal. Uses `requirePOSAccess` (not `requireCashflowAccess`) so the
 * cashier can always call it; `kasbonEnabled` is false for non-Komplit
 * tenants, in which case the cashier hides every kasbon affordance.
 */
export const getCustomerKasbon = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ customerId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    const kasbonEnabled = posTierLimits(auth.posTier).features.includes(
      'cashflow',
    )
    if (!kasbonEnabled) return { kasbonEnabled: false, kasbon: 0 }
    const [row] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${arReceivables.amount} - ${arReceivables.paidAmount}), 0)`,
      })
      .from(arReceivables)
      .where(
        and(
          eq(arReceivables.tenantId, auth.tenantId),
          eq(arReceivables.customerId, data.customerId),
          inArray(arReceivables.status, ['outstanding', 'partial']),
        ),
      )
    return { kasbonEnabled: true, kasbon: Number(row?.total ?? 0) }
  })
