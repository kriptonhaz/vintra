import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  tenants,
  kontenCreditAccounts,
  kontenCreditLedger,
} from '@vintra/db/schema'
import { and, eq, ilike, asc, desc, sql } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type KontenCreditRow = {
  tenantId: string
  businessName: string
  slug: string
  balance: number
}

export type KontenLedgerEntry = {
  id: string
  delta: number
  type: string
  note: string | null
  createdAt: Date
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Applies a signed credit movement: upserts the account balance and writes
 * the matching ledger row in one shot. Caller MUST run this inside a
 * transaction. Throws (rolling the txn back) if the resulting balance would
 * go negative — that is how generation spend is guarded against overdraft.
 * Returns the new balance.
 */
export type KontenLedgerType =
  | 'topup'
  | 'generation'
  | 'refund'
  | 'adjustment'
  | 'signup_grant'

export async function applyKontenCredit(
  tx: DbTx,
  params: {
    tenantId: string
    delta: number
    type: KontenLedgerType
    refId?: string
    note?: string
    createdBy?: string
  },
): Promise<number> {
  const [account] = await tx
    .insert(kontenCreditAccounts)
    .values({ tenantId: params.tenantId, balance: params.delta })
    .onConflictDoUpdate({
      target: kontenCreditAccounts.tenantId,
      set: {
        balance: sql`${kontenCreditAccounts.balance} + ${params.delta}`,
        updatedAt: new Date(),
      },
    })
    .returning({ balance: kontenCreditAccounts.balance })

  if (!account || account.balance < 0) {
    throw new Error('Saldo kredit Konten tidak cukup.')
  }

  await tx.insert(kontenCreditLedger).values({
    tenantId: params.tenantId,
    delta: params.delta,
    type: params.type,
    refId: params.refId ?? null,
    note: params.note ?? null,
    createdBy: params.createdBy ?? null,
  })

  return account.balance
}

/** Free Konten credits granted to a tenant on their first paid Komplit
 *  bundle activation. Single number, tweak here if marketing wants to
 *  bump the welcome gift. */
export const KOMPLIT_SIGNUP_KONTEN_CREDITS = 3

/**
 * Grants the welcome Konten credits to a tenant exactly once across the
 * tenant's lifetime — cancellation + re-subscription does NOT re-grant.
 * Idempotency lives in the ledger: a `signup_grant` row is the unique
 * marker. Caller MUST run this inside a transaction.
 *
 * Returns `{ granted: true, balance }` when the grant fired,
 * `{ granted: false }` when the tenant has previously received it.
 */
export async function grantKontenSignupCreditsOnce(
  tx: DbTx,
  params: { tenantId: string; createdBy?: string },
): Promise<{ granted: boolean; balance?: number }> {
  const [existing] = await tx
    .select({ id: kontenCreditLedger.id })
    .from(kontenCreditLedger)
    .where(
      and(
        eq(kontenCreditLedger.tenantId, params.tenantId),
        eq(kontenCreditLedger.type, 'signup_grant'),
      ),
    )
    .limit(1)
  if (existing) return { granted: false }

  const balance = await applyKontenCredit(tx, {
    tenantId: params.tenantId,
    delta: KOMPLIT_SIGNUP_KONTEN_CREDITS,
    type: 'signup_grant',
    note: 'Bonus aktivasi Komplit',
    createdBy: params.createdBy,
  })
  return { granted: true, balance }
}

export const listKontenCredits = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      search: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const where = data.search
      ? ilike(tenants.businessName, `%${data.search}%`)
      : undefined
    const offset = (data.page - 1) * data.pageSize

    const [rows, [countRow]] = await Promise.all([
      db
        .select({
          tenantId: tenants.id,
          businessName: tenants.businessName,
          slug: tenants.slug,
          balance: kontenCreditAccounts.balance,
        })
        .from(tenants)
        .leftJoin(
          kontenCreditAccounts,
          eq(kontenCreditAccounts.tenantId, tenants.id),
        )
        .where(where)
        .orderBy(asc(tenants.businessName))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenants)
        .where(where),
    ])

    const totalCount = countRow?.count ?? 0
    return {
      rows: rows.map(
        (r): KontenCreditRow => ({
          tenantId: r.tenantId,
          businessName: r.businessName,
          slug: r.slug,
          balance: r.balance ?? 0,
        }),
      ),
      page: data.page,
      pageSize: data.pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / data.pageSize)),
    }
  })

export const getKontenCreditLedger = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<KontenLedgerEntry[]> => {
    await requirePlatformAdmin()
    const rows = await db
      .select({
        id: kontenCreditLedger.id,
        delta: kontenCreditLedger.delta,
        type: kontenCreditLedger.type,
        note: kontenCreditLedger.note,
        createdAt: kontenCreditLedger.createdAt,
      })
      .from(kontenCreditLedger)
      .where(eq(kontenCreditLedger.tenantId, data.tenantId))
      .orderBy(desc(kontenCreditLedger.createdAt))
      .limit(50)
    return rows
  })

export const topUpKontenCredits = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      amount: z
        .number()
        .int('Jumlah kredit harus bilangan bulat')
        .positive('Jumlah kredit harus lebih dari 0')
        .max(100000, 'Jumlah kredit terlalu besar'),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requirePlatformAdmin()
    const balance = await db.transaction((tx) =>
      applyKontenCredit(tx, {
        tenantId: data.tenantId,
        delta: data.amount,
        type: 'topup',
        note: data.note,
        createdBy: admin.userId,
      }),
    )
    return { balance }
  })
