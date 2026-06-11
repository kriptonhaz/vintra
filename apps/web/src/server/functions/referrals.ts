import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { referralCodes, referralAttributions } from '@vintra/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { requireReferralAccess } from '../middleware/referral-access'

const CODE_REGEX = /^[A-Z0-9_-]{4,20}$/
const PCT_REGEX = /^\d+(\.\d{1,2})?$/

const codeSchema = z.string().regex(CODE_REGEX, 'Format kode tidak valid (huruf besar/angka, 4-20 karakter)')
const pctSchema = z.string().regex(PCT_REGEX, 'Persentase tidak valid (maks 2 desimal)')
const labelSchema = z.string().max(100).optional().or(z.literal(''))
// 1..1_000_000 covers every realistic campaign without permitting
// negative values or zero (a zero cap would immediately exhaust the code,
// which is almost certainly a user error rather than intent).
const maxClaimsSchema = z.number().int().min(1).max(1_000_000).nullable().optional()

// Re-validate the "discount + commission ≤ cap" rule server-side so
// the client can't bypass it. `cap` is the caller's per-tenant cap,
// resolved by `requireReferralAccess`.
function assertSumWithinCap(discountPct: string, commissionPct: string, cap: number) {
  const sum = parseFloat(discountPct) + parseFloat(commissionPct)
  if (sum > cap + 1e-9) {
    throw new Error(`Total discount + komisi (${sum.toFixed(2)}%) melebihi cap ${cap}%`)
  }
}

export const getReferralCap = createServerFn({ method: 'GET' }).handler(async () => {
  const { referralCapPct } = await requireReferralAccess()
  return { capPct: referralCapPct }
})

export const listMyReferralCodes = createServerFn({ method: 'GET' }).handler(async () => {
  const { tenantId } = await requireReferralAccess()

  const rows = await db
    .select({
      id: referralCodes.id,
      code: referralCodes.code,
      label: referralCodes.label,
      discountPct: referralCodes.discountPct,
      commissionPct: referralCodes.commissionPct,
      maxClaims: referralCodes.maxClaims,
      isActive: referralCodes.isActive,
      createdAt: referralCodes.createdAt,
      // Count attributions per code so the row can show "X pendaftar"
      // without an extra round trip. LEFT JOIN keeps codes with zero
      // attributions in the result.
      attributionCount: sql<number>`count(${referralAttributions.id})::int`,
    })
    .from(referralCodes)
    .leftJoin(referralAttributions, eq(referralAttributions.codeId, referralCodes.id))
    .where(eq(referralCodes.tenantId, tenantId))
    .groupBy(referralCodes.id)
    .orderBy(sql`${referralCodes.createdAt} desc`)

  return rows
})

const createSchema = z.object({
  code: codeSchema,
  label: labelSchema,
  discountPct: pctSchema,
  commissionPct: pctSchema,
  maxClaims: maxClaimsSchema,
})

export const createReferralCode = createServerFn({ method: 'POST' })
  .inputValidator(createSchema)
  .handler(async ({ data }) => {
    const { tenantId, referralCapPct } = await requireReferralAccess()
    assertSumWithinCap(data.discountPct, data.commissionPct, referralCapPct)

    try {
      const [row] = await db
        .insert(referralCodes)
        .values({
          tenantId,
          code: data.code,
          label: data.label || null,
          discountPct: data.discountPct,
          commissionPct: data.commissionPct,
          maxClaims: data.maxClaims ?? null,
        })
        .returning()
      return row
    } catch (err) {
      // 23505 = unique_violation. Surface a user-friendly message
      // instead of leaking the raw "duplicate key" text.
      if ((err as { code?: string }).code === '23505') {
        throw new Error('Kode referral sudah dipakai')
      }
      throw err
    }
  })

const updateSchema = z.object({
  id: z.string().uuid(),
  label: labelSchema,
  discountPct: pctSchema,
  commissionPct: pctSchema,
  maxClaims: maxClaimsSchema,
})

export const updateReferralCode = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }) => {
    const { tenantId, referralCapPct } = await requireReferralAccess()
    assertSumWithinCap(data.discountPct, data.commissionPct, referralCapPct)

    const [row] = await db
      .update(referralCodes)
      .set({
        label: data.label || null,
        discountPct: data.discountPct,
        commissionPct: data.commissionPct,
        maxClaims: data.maxClaims ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(referralCodes.id, data.id), eq(referralCodes.tenantId, tenantId)))
      .returning()

    if (!row) throw new Error('Kode referral tidak ditemukan')
    return row
  })

const toggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export const toggleReferralCode = createServerFn({ method: 'POST' })
  .inputValidator(toggleSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireReferralAccess()

    const [row] = await db
      .update(referralCodes)
      .set({ isActive: data.isActive, updatedAt: new Date() })
      .where(and(eq(referralCodes.id, data.id), eq(referralCodes.tenantId, tenantId)))
      .returning()

    if (!row) throw new Error('Kode referral tidak ditemukan')
    return row
  })

/**
 * Paginated + searchable listing of every tenant attributed to one
 * of the caller's referral codes. Powers the "Pendaftar" tab on the
 * /referrals page — that view scales past 100+ rows where the
 * earlier Sheet-based drawer would've been unusable.
 *
 * Filters:
 *   - codeId — restrict to a specific one of the caller's codes
 *   - search — ILIKE match on referee tenant business_name
 *   - status — 'paid' (at least one paid invoice) or 'unpaid'
 *
 * Ownership is enforced via `a.referrer_tenant_id = ${tenantId}` so
 * a caller can never see attributions for codes that aren't theirs,
 * even by guessing a `codeId`.
 */
const listAttributionsSchema = z.object({
  codeId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
  status: z.enum(['paid', 'unpaid']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export const listMyAttributions = createServerFn({ method: 'POST' })
  .inputValidator(listAttributionsSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireReferralAccess()

    const offset = (data.page - 1) * data.pageSize
    const searchPattern = data.search?.trim() ? `%${data.search.trim()}%` : null
    const codeIdFilter = data.codeId ?? null
    const statusFilter = data.status ?? null

    // One round trip via window function for pagination total —
    // avoids a separate COUNT query while keeping the row shape clean.
    const rows = await db.execute<{
      attribution_id: string
      attributed_at: Date
      window_ends_at: Date
      referee_id: string
      referee_name: string | null
      active_modules: string[] | null
      code: string | null
      code_id: string
      invoice_count: number
      total_paid: string
      total_commission: string
      total_count: number
    }>(sql`
      SELECT
        a.id AS attribution_id,
        a.attributed_at,
        a.window_ends_at,
        t.id AS referee_id,
        t.business_name AS referee_name,
        t.active_modules AS active_modules,
        rc.code AS code,
        rc.id AS code_id,
        COALESCE(ft_agg.invoice_count, 0) AS invoice_count,
        COALESCE(ft_agg.total_paid, 0) AS total_paid,
        COALESCE(comm_agg.total_commission, 0) AS total_commission,
        COUNT(*) OVER () AS total_count
      FROM referral_attributions a
      JOIN tenants t ON t.id = a.referee_tenant_id
      JOIN referral_codes rc ON rc.id = a.code_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS invoice_count,
          COALESCE(SUM(amount_idr), 0) AS total_paid
        FROM financial_transactions
        WHERE tenant_id = a.referee_tenant_id
          AND status = 'paid'
      ) ft_agg ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount_idr), 0) AS total_commission
        FROM referral_commissions
        WHERE attribution_id = a.id
          AND status != 'reversed'
      ) comm_agg ON true
      WHERE a.referrer_tenant_id = ${tenantId}
        AND (${codeIdFilter}::uuid IS NULL OR a.code_id = ${codeIdFilter}::uuid)
        AND (${searchPattern}::text IS NULL OR t.business_name ILIKE ${searchPattern}::text)
        AND (
          ${statusFilter}::text IS NULL
          OR (${statusFilter}::text = 'paid' AND COALESCE(ft_agg.invoice_count, 0) > 0)
          OR (${statusFilter}::text = 'unpaid' AND COALESCE(ft_agg.invoice_count, 0) = 0)
        )
      ORDER BY a.attributed_at DESC
      LIMIT ${data.pageSize}
      OFFSET ${offset}
    `)

    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0

    return {
      total,
      page: data.page,
      pageSize: data.pageSize,
      items: rows.map((r) => ({
        attributionId: r.attribution_id,
        attributedAt: r.attributed_at,
        windowEndsAt: r.window_ends_at,
        refereeId: r.referee_id,
        refereeName: r.referee_name ?? 'Tenant',
        // 'hpp' is the free baseline — only show truly-purchased modules.
        activeModules: (r.active_modules ?? []).filter((m) => m !== 'hpp'),
        code: r.code ?? '',
        codeId: r.code_id,
        invoiceCount: Number(r.invoice_count),
        totalPaid: r.total_paid,
        totalCommission: r.total_commission,
      })),
    }
  })
