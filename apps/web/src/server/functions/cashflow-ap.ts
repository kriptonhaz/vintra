/**
 * Cicilan / accounts payable (JUR-158).
 *
 * A payable is an installment plan; its `ap_payments` schedule is
 * generated up front at creation. Marking an installment paid posts an
 * `ap_payment` expense row to the cashflow ledger. Due-date reminders
 * are fired by the in-process scheduler (see server/scheduler.ts).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { addMonths, format } from 'date-fns'
import { db } from '@vintra/db'
import {
  apPayables,
  apPayments,
  cashflowEntries,
  suppliers,
} from '@vintra/db/schema'
import { and, eq, inArray, asc } from 'drizzle-orm'
import { requireCashflowAccess } from '../middleware/module-access'
import {
  getSystemCategoryId,
  cashflowDateKey,
  getDefaultAccountId,
} from '../lib/cashflow-sync'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ─── Supplier picker ─────────────────────────────────────────────────

export const listCicilanSuppliers = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.tenantId, auth.tenantId))
    .orderBy(suppliers.name)
})

// ─── List payables + schedule + summary ──────────────────────────────

export const listPayables = createServerFn().handler(async () => {
  const auth = await requireCashflowAccess()
  const payables = await db
    .select({
      id: apPayables.id,
      name: apPayables.name,
      supplierId: apPayables.supplierId,
      supplierName: suppliers.name,
      totalAmount: apPayables.totalAmount,
      scheduleKind: apPayables.scheduleKind,
      installmentCount: apPayables.installmentCount,
      remindersMuted: apPayables.remindersMuted,
      note: apPayables.note,
      createdAt: apPayables.createdAt,
    })
    .from(apPayables)
    .leftJoin(suppliers, eq(suppliers.id, apPayables.supplierId))
    .where(eq(apPayables.tenantId, auth.tenantId))
    .orderBy(asc(apPayables.createdAt))

  const ids = payables.map((p) => p.id)
  const payments = ids.length
    ? await db
        .select()
        .from(apPayments)
        .where(inArray(apPayments.payableId, ids))
        .orderBy(asc(apPayments.installmentIndex))
    : []

  const today = cashflowDateKey(new Date())
  const monthPrefix = today.slice(0, 7) // YYYY-MM
  const in30 = new Date(
    new Date(`${today}T00:00:00Z`).getTime() + 30 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10)

  let totalOutstanding = 0
  let dueThisMonth = 0
  let dueNext30d = 0

  const items = payables.map((p) => {
    const lines = payments
      .filter((pm) => pm.payableId === p.id)
      .map((pm) => {
        const amount = Number(pm.amount)
        const paid = pm.paidAt != null
        const overdue = !paid && pm.dueDate < today
        if (!paid) {
          totalOutstanding += amount
          if (pm.dueDate.slice(0, 7) === monthPrefix) dueThisMonth += amount
          if (pm.dueDate <= in30) dueNext30d += amount
        }
        return {
          id: pm.id,
          installmentIndex: pm.installmentIndex,
          amount,
          dueDate: pm.dueDate,
          paidAt: pm.paidAt,
          method: pm.method,
          note: pm.note,
          paid,
          overdue,
        }
      })
    const paidCount = lines.filter((l) => l.paid).length
    const outstanding = lines
      .filter((l) => !l.paid)
      .reduce((s, l) => s + l.amount, 0)
    const nextDue = lines.find((l) => !l.paid)?.dueDate ?? null
    return {
      id: p.id,
      name: p.name,
      supplierId: p.supplierId,
      supplierName: p.supplierName,
      totalAmount: Number(p.totalAmount),
      scheduleKind: p.scheduleKind as 'one_off' | 'monthly',
      installmentCount: p.installmentCount,
      remindersMuted: p.remindersMuted,
      note: p.note,
      paidCount,
      outstanding,
      nextDue,
      hasOverdue: lines.some((l) => l.overdue),
      lines,
    }
  })

  return {
    items,
    summary: { totalOutstanding, dueThisMonth, dueNext30d },
  }
})

// ─── Create payable + generate schedule ──────────────────────────────

export const createPayable = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().trim().min(1, 'Nama cicilan wajib diisi').max(120),
      supplierId: z.string().uuid().optional().nullable(),
      scheduleKind: z.enum(['one_off', 'monthly']),
      totalAmount: z.coerce.number().positive('Jumlah harus lebih dari 0'),
      installmentCount: z.coerce.number().int().min(1).max(120),
      firstDueDate: z.string().regex(DATE_RE, 'Tanggal tidak valid'),
      note: z.string().trim().max(500).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()

    if (data.supplierId) {
      const [sup] = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, data.supplierId),
            eq(suppliers.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!sup) throw new Error('Supplier tidak ditemukan.')
    }

    const count = data.scheduleKind === 'one_off' ? 1 : data.installmentCount
    const total = data.totalAmount
    // Even split; the final installment absorbs any rounding remainder.
    const base = Math.floor(total / count)
    const firstDue = new Date(`${data.firstDueDate}T00:00:00Z`)

    const payableId = await db.transaction(async (tx) => {
      const [payable] = await tx
        .insert(apPayables)
        .values({
          tenantId: auth.tenantId,
          name: data.name,
          supplierId: data.supplierId ?? null,
          totalAmount: String(total),
          scheduleKind: data.scheduleKind,
          installmentCount: count,
          firstDueDate: data.firstDueDate,
          note: data.note ?? null,
        })
        .returning({ id: apPayables.id })

      const rows = Array.from({ length: count }, (_, i) => ({
        payableId: payable!.id,
        installmentIndex: i + 1,
        amount: String(i === count - 1 ? total - base * (count - 1) : base),
        dueDate: format(addMonths(firstDue, i), 'yyyy-MM-dd'),
      }))
      await tx.insert(apPayments).values(rows)
      return payable!.id
    })

    return { id: payableId }
  })

// ─── Mark an installment paid ────────────────────────────────────────

export const markInstallmentPaid = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      paymentId: z.string().uuid(),
      method: z.enum(['cash', 'transfer', 'qris', 'other']),
      note: z.string().trim().max(500).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [row] = await db
      .select({
        paymentId: apPayments.id,
        amount: apPayments.amount,
        paidAt: apPayments.paidAt,
        payableName: apPayables.name,
        tenantId: apPayables.tenantId,
      })
      .from(apPayments)
      .innerJoin(apPayables, eq(apPayables.id, apPayments.payableId))
      .where(eq(apPayments.id, data.paymentId))
      .limit(1)
    if (!row || row.tenantId !== auth.tenantId) {
      throw new Error('Cicilan tidak ditemukan.')
    }
    if (row.paidAt != null) {
      throw new Error('Cicilan ini sudah ditandai lunas.')
    }

    const categoryId = await getSystemCategoryId('Lain-lain', 'expense')
    if (!categoryId) {
      throw new Error('Kategori pengeluaran sistem belum ada.')
    }
    const accountId = await getDefaultAccountId(auth.tenantId)
    const now = new Date()

    await db.transaction(async (tx) => {
      await tx
        .update(apPayments)
        .set({
          paidAt: now,
          method: data.method,
          note: data.note ?? null,
          recordedByUserId: auth.userId,
        })
        .where(eq(apPayments.id, data.paymentId))

      await tx.insert(cashflowEntries).values({
        tenantId: auth.tenantId,
        accountId,
        type: 'expense',
        categoryId,
        amount: String(row.amount),
        date: cashflowDateKey(now),
        source: 'ap_payment',
        sourceRef: data.paymentId,
        note: `Cicilan ${row.payableName}`,
        createdByUserId: auth.userId,
      })
    })
    return { ok: true }
  })

// ─── Mute / unmute reminders ─────────────────────────────────────────

export const togglePayableReminders = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ payableId: z.string().uuid(), muted: z.boolean() }),
  )
  .handler(async ({ data }) => {
    const auth = await requireCashflowAccess()
    const [p] = await db
      .select({ id: apPayables.id, tenantId: apPayables.tenantId })
      .from(apPayables)
      .where(eq(apPayables.id, data.payableId))
      .limit(1)
    if (!p || p.tenantId !== auth.tenantId) {
      throw new Error('Cicilan tidak ditemukan.')
    }
    await db
      .update(apPayables)
      .set({ remindersMuted: data.muted, updatedAt: new Date() })
      .where(eq(apPayables.id, data.payableId))
    return { ok: true }
  })
