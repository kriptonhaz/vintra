/**
 * POS ↔ accounts-receivable sync helpers (JUR-191).
 *
 * Used inside the `createSale` transaction so a kasbon sale and its
 * receivable / payment rows commit atomically with the sale itself.
 */
import { db } from '@vintra/db'
import { arReceivables, arPayments, cashflowEntries } from '@vintra/db/schema'
import { and, eq, inArray, asc } from 'drizzle-orm'
import {
  getPenjualanCategoryId,
  cashflowDateKey,
  getDefaultAccountId,
} from './cashflow-sync'

export type ArMethod = 'cash' | 'transfer' | 'qris' | 'other'

/** Map a POS payment method onto the AR payment-method enum. */
export function mapPosMethodToArMethod(method: string): ArMethod {
  if (method === 'cash' || method === 'transfer' || method === 'qris') {
    return method
  }
  return 'other'
}

/**
 * Create a kasbon (receivable) for the unpaid portion of a POS sale.
 */
export async function createSaleReceivable(
  exec: typeof db,
  input: {
    tenantId: string
    customerId: string
    saleId: string
    amount: number
  },
): Promise<void> {
  await exec.insert(arReceivables).values({
    tenantId: input.tenantId,
    customerId: input.customerId,
    saleId: input.saleId,
    amount: String(input.amount),
    status: 'outstanding',
  })
}

/**
 * Apply a kasbon payment FIFO across a customer's outstanding
 * receivables (oldest first). Each receivable touched gets an
 * `ar_payments` row + a paired `ar_payment` cashflow income entry, and
 * flips to `partial` / `paid`.
 *
 * Throws if `amount` exceeds the customer's total outstanding kasbon —
 * rolling back the surrounding sale transaction.
 */
export async function applyKasbonPaymentFifo(
  exec: typeof db,
  input: {
    tenantId: string
    customerId: string
    amount: number
    method: ArMethod
    userId: string
    now: Date
  },
): Promise<void> {
  if (input.amount <= 0) return
  const categoryId = await getPenjualanCategoryId()
  if (!categoryId) {
    throw new Error('Kategori sistem "Penjualan" belum ada.')
  }
  const accountId = await getDefaultAccountId(input.tenantId)

  const receivables = await exec
    .select()
    .from(arReceivables)
    .where(
      and(
        eq(arReceivables.tenantId, input.tenantId),
        eq(arReceivables.customerId, input.customerId),
        inArray(arReceivables.status, ['outstanding', 'partial']),
      ),
    )
    .orderBy(asc(arReceivables.createdAt))

  let remaining = input.amount
  for (const r of receivables) {
    if (remaining <= 0.001) break
    const outstanding = Number(r.amount) - Number(r.paidAmount)
    if (outstanding <= 0) continue
    const pay = Math.min(remaining, outstanding)
    const paidAfter = Number(r.paidAmount) + pay
    const fullyPaid = paidAfter >= Number(r.amount) - 0.001

    const [payment] = await exec
      .insert(arPayments)
      .values({
        receivableId: r.id,
        amount: String(pay),
        method: input.method,
        note: 'Pembayaran kasbon di kasir',
        recordedByUserId: input.userId,
      })
      .returning({ id: arPayments.id })

    await exec
      .update(arReceivables)
      .set({
        paidAmount: String(paidAfter),
        status: fullyPaid ? 'paid' : 'partial',
        paidAt: fullyPaid ? input.now : r.paidAt,
        updatedAt: input.now,
      })
      .where(eq(arReceivables.id, r.id))

    await exec.insert(cashflowEntries).values({
      tenantId: input.tenantId,
      accountId,
      type: 'income',
      categoryId,
      amount: String(pay),
      date: cashflowDateKey(input.now),
      source: 'ar_payment',
      sourceRef: payment!.id,
      note: 'Pembayaran kasbon di kasir',
      createdByUserId: input.userId,
    })

    remaining -= pay
  }

  if (remaining > 0.001) {
    throw new Error('Pembayaran kasbon melebihi total kasbon pelanggan.')
  }
}
