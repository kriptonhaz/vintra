import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { db } from '@vintra/db'
import {
  tenants,
  attendanceSettings,
  inventorySettings,
  posSettings,
  financialTransactions,
  financialInvoiceCounters,
  platformAdminAuditLogs,
  branches,
} from '@vintra/db/schema'
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  findPlan,
  attendanceTotal,
  addMonths,
  ATTENDANCE_PLANS,
  ATTENDANCE_TRIAL_DEFAULTS,
  TRIAL_PLAN,
  findInventoryPlan,
  inventoryTotal,
  INVENTORY_PLANS,
  INVENTORY_TRIAL_DEFAULTS,
  INVENTORY_TRIAL_PLAN,
  findPOSPlan,
  posTotal,
  POS_PLANS,
  POS_TRIAL_DEFAULTS,
  POS_TRIAL_PLAN,
} from '@vintra/shared'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import {
  creditReferralCommissionIfApplicable,
  reverseReferralCommissionsForInvoice,
} from '../lib/referral-credit'
import { applyReferralDiscount } from '../lib/referral-discount'
import { grantKontenSignupCreditsOnce } from './admin-konten-credits'
import {
  uploadFinancialProof,
  getFinancialProofSignedUrl,
  parseDataUrl,
} from '@/lib/s3-storage'
import { createNotification } from '../notifications'
import {
  sendEmail,
  buildPaymentReceiptEmail,
  buildRefundReceiptEmail,
} from '../email'
import { NOTIFICATION_TYPES } from '@vintra/shared'

// Map plan labelKey → human Indonesian label for transactional emails.
// (Email templates are server-side and don't have access to i18next.)
const PLAN_LABEL_ID: Record<string, string> = {
  'pricing.planMonthly': 'Bulanan',
  'pricing.plan3mo': '3 Bulan',
  'pricing.plan6mo': '6 Bulan',
  'pricing.plan12mo': '12 Bulan',
  'pricing.planTrial': 'Trial',
  'pricing.inventoryFree': 'Gratis',
  'pricing.inventoryTokoMonthly': 'Toko · Bulanan',
  'pricing.inventoryTokoAnnual': 'Toko · Tahunan',
  'pricing.inventoryBisnisMonthly': 'Bisnis · Bulanan',
  'pricing.inventoryBisnisAnnual': 'Bisnis · Tahunan',
  'pricing.inventoryMultiOutletMonthly': 'Multi-Outlet · Bulanan',
  'pricing.inventoryMultiOutletAnnual': 'Multi-Outlet · Tahunan',
  'pricing.inventoryTrial': 'Trial Inventory',
  'pricing.posFree': 'Gratis',
  'pricing.posTokoMonthly': 'POS Toko · Bulanan',
  'pricing.posTokoAnnual': 'POS Toko · Tahunan',
  'pricing.posKomplitMonthly': 'Komplit · Bulanan',
  'pricing.posKomplitAnnual': 'Komplit · Tahunan',
  'pricing.posBisnisMonthly': 'Bisnis · Bulanan',
  'pricing.posBisnisAnnual': 'Bisnis · Tahunan',
  'pricing.posMultiOutletMonthly': 'Multi-Outlet · Bulanan',
  'pricing.posMultiOutletAnnual': 'Multi-Outlet · Tahunan',
  'pricing.posTrial': 'Trial Kasir',
}

const APP_URL =
  process.env.VITE_APP_URL ?? process.env.APP_URL ?? 'https://vintra.my.id'

const MODULE_KEY_ATTENDANCE = 'attendance'

function getSupabaseServer() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseServer()
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data.user?.email ?? null
  } catch {
    return null
  }
}

async function getUsersEmails(
  userIds: string[],
): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)))
  const pairs = await Promise.all(
    unique.map(async (id) => [id, await getUserEmail(id)] as const),
  )
  return Object.fromEntries(pairs)
}

// ─── Invoice-number generator ────────────────────────
// Atomic, per-year, monotonic. Safe under concurrent inserts because the
// upsert+returning is a single statement; PostgreSQL serializes the
// row-level update on conflict.

async function nextInvoiceNumber(
  tx: typeof db,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear()
  const [row] = await tx.execute<{ last_number: number }>(sql`
    INSERT INTO ${financialInvoiceCounters} ("year", "last_number", "updated_at")
    VALUES (${year}, 1, now())
    ON CONFLICT ("year") DO UPDATE
      SET "last_number" = ${financialInvoiceCounters.lastNumber} + 1,
          "updated_at" = now()
    RETURNING "last_number"
  `)
  const n = row?.last_number ?? 1
  return `INV-${year}-${String(n).padStart(4, '0')}`
}

// ─── Filter schema ────────────────────────────────────

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD')

const listFilterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  moduleKey: z.string().optional(),
  status: z.enum(['all', 'paid', 'refund']).default('all'),
  // transfer_date bounds, not created_at — admin thinks in terms of "when
  // did the money move" not "when did I type the entry".
  from: dateStr.optional(),
  to: dateStr.optional(),
  // Tenant name substring for the search box.
  tenantSearch: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
})

type ListFilter = z.infer<typeof listFilterSchema>

function buildListConditions(filter: ListFilter) {
  const conds = []
  if (filter.tenantId) {
    conds.push(eq(financialTransactions.tenantId, filter.tenantId))
  }
  if (filter.moduleKey) {
    conds.push(eq(financialTransactions.moduleKey, filter.moduleKey))
  }
  if (filter.status !== 'all') {
    conds.push(eq(financialTransactions.status, filter.status))
  }
  if (filter.from) {
    conds.push(gte(financialTransactions.transferDate, filter.from))
  }
  if (filter.to) {
    conds.push(lte(financialTransactions.transferDate, filter.to))
  }
  if (filter.tenantSearch && filter.tenantSearch.trim().length > 0) {
    const like = `%${filter.tenantSearch.trim().toLowerCase()}%`
    conds.push(sql`lower(${tenants.businessName}) LIKE ${like}`)
  }
  return conds
}

// ─── Read: cross-tenant ledger for /admin/finance ────

export const listTransactions = createServerFn()
  .inputValidator(listFilterSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const conds = buildListConditions(data)
    const offset = (data.page - 1) * data.pageSize

    const [rows, totalRow, summaryRow] = await Promise.all([
      db
        .select({
          id: financialTransactions.id,
          tenantId: financialTransactions.tenantId,
          tenantName: tenants.businessName,
          invoiceNumber: financialTransactions.invoiceNumber,
          moduleKey: financialTransactions.moduleKey,
          planKey: financialTransactions.planKey,
          periodStartAt: financialTransactions.periodStartAt,
          periodEndAt: financialTransactions.periodEndAt,
          amountIdr: financialTransactions.amountIdr,
          transferDate: financialTransactions.transferDate,
          status: financialTransactions.status,
          billedStaffCount: financialTransactions.billedStaffCount,
          billedOutletCount: financialTransactions.billedOutletCount,
          recordedByUserId: financialTransactions.recordedByUserId,
          createdAt: financialTransactions.createdAt,
          refundOfTransactionId: financialTransactions.refundOfTransactionId,
        })
        .from(financialTransactions)
        .innerJoin(tenants, eq(financialTransactions.tenantId, tenants.id))
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(financialTransactions.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(financialTransactions)
        .innerJoin(tenants, eq(financialTransactions.tenantId, tenants.id))
        .where(conds.length > 0 ? and(...conds) : undefined),
      db
        .select({
          paid: sql<number>`
            coalesce(sum(case when ${financialTransactions.status} = 'paid'
              then ${financialTransactions.amountIdr}::bigint else 0 end), 0)::bigint
          `,
          refund: sql<number>`
            coalesce(sum(case when ${financialTransactions.status} = 'refund'
              then ${financialTransactions.amountIdr}::bigint else 0 end), 0)::bigint
          `,
          count: sql<number>`count(*)::int`,
        })
        .from(financialTransactions)
        .innerJoin(tenants, eq(financialTransactions.tenantId, tenants.id))
        .where(conds.length > 0 ? and(...conds) : undefined),
    ])

    const totalCount = totalRow[0]?.count ?? 0
    // sum() returns bigint — comes back as string from node-postgres.
    // Coerce to number; IDR amounts stay well within Number.MAX_SAFE_INTEGER.
    const paid = Number(summaryRow[0]?.paid ?? 0)
    const refund = Number(summaryRow[0]?.refund ?? 0)

    const emails = await getUsersEmails(rows.map((r) => r.recordedByUserId))

    return {
      rows: rows.map((r) => ({
        ...r,
        amountIdr: Number(r.amountIdr),
        recordedByEmail: emails[r.recordedByUserId] ?? null,
      })),
      page: data.page,
      pageSize: data.pageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / data.pageSize)),
      summary: {
        paid,
        refund,
        net: paid - refund,
        count: summaryRow[0]?.count ?? 0,
      },
    }
  })

// ─── Read: one tenant's recent transactions ──────────

export const getTenantTransactions = createServerFn()
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const rows = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.tenantId, data.tenantId))
      .orderBy(desc(financialTransactions.createdAt))
      .limit(20)

    const emails = await getUsersEmails(rows.map((r) => r.recordedByUserId))

    // Compute which paid rows already have a refund referencing them so
    // the UI can gray out the "Refund" action on those.
    const refundedOriginalIds = new Set(
      rows
        .filter((r) => r.status === 'refund' && r.refundOfTransactionId)
        .map((r) => r.refundOfTransactionId!),
    )

    return rows.map((r) => ({
      ...r,
      amountIdr: Number(r.amountIdr),
      recordedByEmail: emails[r.recordedByUserId] ?? null,
      hasRefund: refundedOriginalIds.has(r.id),
    }))
  })

// ─── Read: single transaction detail (+ signed proof URL) ──

export const getTransaction = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [row] = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, data.id))
      .limit(1)
    if (!row) throw new Error('Transaksi tidak ditemukan')

    const recordedByEmail = await getUserEmail(row.recordedByUserId)
    const proofUrl = row.proofPhotoKey
      ? await getFinancialProofSignedUrl(row.proofPhotoKey).catch(() => null)
      : null

    // Pair-wise lookups for the detail drawer — if this row IS a refund,
    // fetch the original; if this row HAS a refund, fetch the refund row.
    let originalTransaction: typeof row | null = null
    let refundTransaction: typeof row | null = null
    if (row.status === 'refund' && row.refundOfTransactionId) {
      const [orig] = await db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, row.refundOfTransactionId))
        .limit(1)
      originalTransaction = orig ?? null
    } else if (row.status === 'paid') {
      const [ref] = await db
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.refundOfTransactionId, row.id))
        .limit(1)
      refundTransaction = ref ?? null
    }

    return {
      ...row,
      amountIdr: Number(row.amountIdr),
      recordedByEmail,
      proofUrl,
      originalTransaction: originalTransaction
        ? { ...originalTransaction, amountIdr: Number(originalTransaction.amountIdr) }
        : null,
      refundTransaction: refundTransaction
        ? { ...refundTransaction, amountIdr: Number(refundTransaction.amountIdr) }
        : null,
    }
  })

// ─── Mutation: record payment + activate/extend subscription ──

export const recordPaymentAndActivate = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      moduleKey: z.literal('attendance'),
      planKey: z
        .string()
        .refine((k) => ATTENDANCE_PLANS.some((p) => p.key === k), {
          message: 'Plan tidak valid',
        }),
      billedStaffCount: z.number().int().min(1, 'Minimal 1 staf'),
      transferDate: dateStr,
      bankReference: z.string().max(200).optional(),
      proofDataUrl: z.string().optional(),
      notes: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const plan = findPlan(data.planKey)
    if (!plan) throw new Error('Plan tidak ditemukan')
    const amountIdr = attendanceTotal(data.planKey, data.billedStaffCount)

    // Tenant must exist
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    // Determine period start: stack on top of the current expiry when the
    // tenant is already on an active, non-expired subscription. Otherwise
    // start from today.
    const [currentSettings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, data.tenantId))
      .limit(1)
    const now = new Date()
    const currentExpiry = currentSettings?.subscriptionExpiresAt
      ? new Date(currentSettings.subscriptionExpiresAt)
      : null
    const hasActive =
      (currentSettings?.subscriptionActive ?? false) &&
      currentExpiry != null &&
      currentExpiry.getTime() > now.getTime()
    const periodStart = hasActive ? currentExpiry! : now
    const periodEnd = addMonths(periodStart, plan.durationMonths)

    // Upload proof FIRST (outside the DB tx) so we don't hold a row lock
    // while waiting on S3. If tx rolls back later the orphan object is
    // fine — finance proofs don't have a lifecycle cost issue at our scale.
    let proofKey: string | null = null
    if (data.proofDataUrl) {
      const { bytes, mimeType } = parseDataUrl(data.proofDataUrl)
      // We don't know the invoice number yet — use a temp name, rename
      // after generating. Simpler path: upload with a temp key, then on
      // success generate a pointer object. For now keep it simple:
      // upload once per final invoice number — generate the invoice
      // number INSIDE the tx and include as part of a follow-up upload
      // after the tx commits. Wait — that breaks atomicity.
      //
      // Compromise: upload under a UUID-based key now; store that key on
      // the transaction row. We lose the "find object by invoice number"
      // debugging convenience but gain simplicity + no renaming.
      const tempKey = crypto.randomUUID()
      const { key } = await uploadFinancialProof({
        tenantId: data.tenantId,
        invoiceNumber: tempKey,
        bytes,
        mimeType,
      })
      proofKey = key
    }

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      // JUR-96: apply referral discount server-side. Helper returns
      // the full amount when no attribution exists, so the no-referral
      // path is unaffected.
      const { finalAmountIdr } = await applyReferralDiscount({
        tx,
        refereeTenantId: data.tenantId,
        fullAmountIdr: amountIdr,
      })

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: data.moduleKey,
          planKey: data.planKey,
          periodStartAt: periodStart,
          periodEndAt: periodEnd,
          amountIdr: finalAmountIdr.toString(),
          transferDate: data.transferDate,
          bankReference: data.bankReference ?? null,
          proofPhotoKey: proofKey,
          billedStaffCount: data.billedStaffCount,
          notes: data.notes ?? null,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // JUR-94: credit the referral commission if the tenant was
      // attributed via a referral code. No-ops silently otherwise.
      await creditReferralCommissionIfApplicable({
        tx,
        refereeTenantId: data.tenantId,
        amountIdr: inserted!.amountIdr,
        invoiceId: inserted!.id,
      })

      // Upsert the attendance settings row with the new expiry + staff count.
      await tx
        .insert(attendanceSettings)
        .values({
          tenantId: data.tenantId,
          subscriptionActive: true,
          subscriptionStartedAt: currentSettings?.subscriptionStartedAt ?? now,
          subscriptionExpiresAt: periodEnd,
          billedStaffCount: data.billedStaffCount,
        })
        .onConflictDoUpdate({
          target: attendanceSettings.tenantId,
          set: {
            subscriptionActive: true,
            subscriptionExpiresAt: periodEnd,
            billedStaffCount: data.billedStaffCount,
            updatedAt: now,
          },
        })

      // Ensure attendance is in activeModules. Idempotent.
      const activeModules = tenant.activeModules ?? []
      if (!activeModules.includes(MODULE_KEY_ATTENDANCE)) {
        await tx
          .update(tenants)
          .set({
            activeModules: [...activeModules, MODULE_KEY_ATTENDANCE],
            updatedAt: now,
          })
          .where(eq(tenants.id, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'finance_record_payment',
        targetTenantId: data.tenantId,
        metadata: {
          invoiceNumber,
          moduleKey: data.moduleKey,
          planKey: data.planKey,
          amountIdr,
          billedStaffCount: data.billedStaffCount,
          periodStartAt: periodStart.toISOString(),
          periodEndAt: periodEnd.toISOString(),
        },
      })

      return {
        transactionId: inserted!.id,
        invoiceNumber,
        amountIdr,
        periodStartAt: periodStart.toISOString(),
        periodEndAt: periodEnd.toISOString(),
      }
    })

    // Notify the tenant owner that their payment landed and the
    // module is active. Fires AFTER the tx commits — createNotification
    // swallows its own errors so a push glitch never bubbles up.
    await createNotification({
      userId: tenant.ownerId,
      tenantId: data.tenantId,
      type: NOTIFICATION_TYPES.paymentReceived,
      title: 'Pembayaran Diterima',
      body: `Pembayaran untuk ${tenant.businessName} berhasil diproses. Modul Absensi aktif sampai ${result.periodEndAt.slice(0, 10)}.`,
      url: '/attendance/billing',
      sourceKey: result.transactionId,
    })

    // Email receipt to the tenant owner. Resolves the email via the
    // Supabase admin API; sendEmail swallows its own errors so an
    // email blip never rolls back the (already-committed) transaction.
    const ownerEmail = await getUserEmail(tenant.ownerId)
    if (ownerEmail) {
      const tpl = buildPaymentReceiptEmail({
        tenantName: tenant.businessName,
        invoiceNumber: result.invoiceNumber,
        planLabel: PLAN_LABEL_ID[plan.labelKey] ?? plan.labelKey,
        periodStart: result.periodStartAt,
        periodEnd: result.periodEndAt,
        billedStaffCount: data.billedStaffCount,
        amountIdr: result.amountIdr,
        paidDate: data.transferDate,
        bankReference: data.bankReference,
        billingUrl: `${APP_URL}/attendance/billing`,
      })
      await sendEmail({
        to: ownerEmail,
        toName: tenant.businessName,
        subject: tpl.subject,
        htmlContent: tpl.htmlContent,
        textContent: tpl.textContent,
        tag: 'payment-receipt',
      })
    }

    return result
  })

// ─── Mutation: record refund ─────────────────────────

export const recordRefund = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      originalTransactionId: z.string().uuid(),
      refundReason: z.string().min(1, 'Alasan refund wajib diisi').max(1000),
      transferDate: dateStr,
      proofDataUrl: z.string().optional(),
      endSubscriptionNow: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [original] = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, data.originalTransactionId))
      .limit(1)
    if (!original) throw new Error('Transaksi asli tidak ditemukan')
    if (original.status !== 'paid') {
      throw new Error('Hanya transaksi berstatus "Lunas" yang bisa direfund')
    }

    const [existingRefund] = await db
      .select({ id: financialTransactions.id })
      .from(financialTransactions)
      .where(eq(financialTransactions.refundOfTransactionId, original.id))
      .limit(1)
    if (existingRefund) {
      throw new Error('Transaksi ini sudah pernah direfund')
    }

    // Optional proof upload (same rationale as payment — outside the tx)
    let proofKey: string | null = null
    if (data.proofDataUrl) {
      const { bytes, mimeType } = parseDataUrl(data.proofDataUrl)
      const tempKey = `refund-${crypto.randomUUID()}`
      const { key } = await uploadFinancialProof({
        tenantId: original.tenantId,
        invoiceNumber: tempKey,
        bytes,
        mimeType,
      })
      proofKey = key
    }

    const now = new Date()

    const result = await db.transaction(async (tx) => {
      const refundInvoice = await nextInvoiceNumber(tx as any, now)

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: original.tenantId,
          invoiceNumber: refundInvoice,
          moduleKey: original.moduleKey,
          planKey: original.planKey,
          // Mirror the period the refund is undoing — useful in reports.
          periodStartAt: original.periodStartAt,
          periodEndAt: original.periodEndAt,
          amountIdr: original.amountIdr,
          transferDate: data.transferDate,
          proofPhotoKey: proofKey,
          billedStaffCount: original.billedStaffCount,
          notes: data.refundReason,
          status: 'refund',
          refundOfTransactionId: original.id,
          recordedByUserId: auth.userId,
        })
        .returning()

      if (data.endSubscriptionNow) {
        // Cut access. The expiry guard checks both activeModules AND
        // subscriptionActive, so we clear both for belt-and-suspenders.
        // Dispatch to the right *_settings table based on the
        // original transaction's moduleKey — refund must hit the
        // module that was actually paid for.
        //
        // Komplit asymmetry fix: a POS Komplit purchase activates
        // POS + Inventory + Attendance in one transaction (see
        // recordPOSPaymentAndActivate). Refunding it with endNow=true
        // must unbundle the same three — otherwise admin clicks
        // "Refund + cut access" on a Komplit payment and the tenant
        // keeps using Inventory and Attendance for free until those
        // settings' own expiries roll. Detect via the POS plan tier;
        // standalone POS Toko refunds keep the single-module path.
        const isKomplitRefund =
          original.moduleKey === 'pos' &&
          findPOSPlan(original.planKey)?.tier === 'komplit'

        const modulesToDeactivate: Array<'pos' | 'inventory' | 'attendance'> =
          isKomplitRefund
            ? ['pos', 'inventory', 'attendance']
            : [original.moduleKey as 'pos' | 'inventory' | 'attendance']

        for (const m of modulesToDeactivate) {
          if (m === 'inventory') {
            await tx
              .update(inventorySettings)
              .set({
                subscriptionActive: false,
                subscriptionExpiresAt: now,
                updatedAt: now,
              })
              .where(eq(inventorySettings.tenantId, original.tenantId))
          } else if (m === 'pos') {
            await tx
              .update(posSettings)
              .set({
                subscriptionActive: false,
                subscriptionExpiresAt: now,
                updatedAt: now,
              })
              .where(eq(posSettings.tenantId, original.tenantId))
          } else {
            await tx
              .update(attendanceSettings)
              .set({
                subscriptionActive: false,
                subscriptionExpiresAt: now,
                updatedAt: now,
              })
              .where(eq(attendanceSettings.tenantId, original.tenantId))
          }
        }

        const [tenantRow] = await tx
          .select({ activeModules: tenants.activeModules })
          .from(tenants)
          .where(eq(tenants.id, original.tenantId))
          .limit(1)
        const remaining = (tenantRow?.activeModules ?? []).filter(
          (m) => !modulesToDeactivate.includes(m as 'pos' | 'inventory' | 'attendance'),
        )
        await tx
          .update(tenants)
          .set({ activeModules: remaining, updatedAt: now })
          .where(eq(tenants.id, original.tenantId))
      }

      // JUR-94: reverse any referral commission that was credited
      // off this original payment. Pending/claimable get flipped to
      // 'reversed'; already-paid commissions can't auto-recover so
      // we surface them via the audit log metadata for manual
      // recovery from the referrer.
      const reversal = await reverseReferralCommissionsForInvoice({
        tx,
        originalInvoiceId: original.id,
      })

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'finance_record_refund',
        targetTenantId: original.tenantId,
        metadata: {
          refundInvoiceNumber: refundInvoice,
          originalInvoiceNumber: original.invoiceNumber,
          refundAmount: Number(original.amountIdr),
          endedSubscription: data.endSubscriptionNow,
          referralCommissionsReversed: reversal.reversed,
          referralCommissionsPostPaid: reversal.postPaidCount,
        },
      })

      if (reversal.postPaidCount > 0) {
        // Separate audit row so the alert is easy to grep / dashboard.
        await tx.insert(platformAdminAuditLogs).values({
          adminUserId: auth.userId,
          action: 'referral_commission_post_paid_refund_alert',
          targetTenantId: original.tenantId,
          metadata: {
            originalInvoiceNumber: original.invoiceNumber,
            refundInvoiceNumber: refundInvoice,
            count: reversal.postPaidCount,
            note: 'Referrer was already paid for this commission — manual recovery may be needed.',
          },
        })
      }

      return {
        refundTransactionId: inserted!.id,
        refundInvoiceNumber: refundInvoice,
      }
    })

    // Notify the tenant owner of the refund. Need to look up the
    // owner since `original` only has tenant_id.
    const [tenant] = await db
      .select({ ownerId: tenants.ownerId, businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, original.tenantId))
      .limit(1)
    if (tenant) {
      // Notification + email copy diverge by module so the user
      // sees the correct module name + lands on the right billing
      // page when they click through.
      const moduleLabel =
        original.moduleKey === 'inventory'
          ? 'Inventory'
          : original.moduleKey === 'pos'
            ? 'Kasir'
            : 'Absensi'
      const billingUrl =
        original.moduleKey === 'inventory'
          ? '/inventory/billing'
          : original.moduleKey === 'pos'
            ? '/pos/billing'
            : '/attendance/billing'
      const notificationType =
        original.moduleKey === 'inventory'
          ? NOTIFICATION_TYPES.inventoryRefundProcessed
          : original.moduleKey === 'pos'
            ? NOTIFICATION_TYPES.posRefundProcessed
            : NOTIFICATION_TYPES.refundProcessed

      await createNotification({
        userId: tenant.ownerId,
        tenantId: original.tenantId,
        type: notificationType,
        title: 'Refund Diproses',
        body: `Refund untuk invoice ${original.invoiceNumber} telah diproses${data.endSubscriptionNow ? `. Modul ${moduleLabel} telah dinonaktifkan.` : '.'}`,
        url: billingUrl,
        sourceKey: result.refundTransactionId,
      })

      // Email refund confirmation to the owner.
      const ownerEmail = await getUserEmail(tenant.ownerId)
      if (ownerEmail) {
        const tpl = buildRefundReceiptEmail({
          tenantName: tenant.businessName,
          refundInvoiceNumber: result.refundInvoiceNumber,
          originalInvoiceNumber: original.invoiceNumber,
          refundAmountIdr: Number(original.amountIdr),
          refundReason: data.refundReason,
          refundDate: data.transferDate,
          endedSubscription: data.endSubscriptionNow,
          billingUrl: `${APP_URL}${billingUrl}`,
        })
        await sendEmail({
          to: ownerEmail,
          toName: tenant.businessName,
          subject: tpl.subject,
          htmlContent: tpl.htmlContent,
          textContent: tpl.textContent,
          tag: 'refund-receipt',
        })
      }
    }

    return result
  })

// ─── Trial ───────────────────────────────────────────
// Admin-triggered trial for the attendance module. One-time per tenant
// (gated by attendance_settings.trial_used). Creates a ledger entry at
// amount=0 so the finance timeline is complete.

const trialStartSchema = z.object({
  tenantId: z.string().uuid(),
  durationDays: z.number().int().min(1).max(30).optional(),
  /**
   * `null` (or omitted) = unlimited. The default in
   * ATTENDANCE_TRIAL_DEFAULTS is null since trials no longer carry a
   * staff cap by policy; admin can still pin a number per tenant.
   */
  staffCap: z.number().int().min(1).max(100).nullable().optional(),
})

export const startTrial = createServerFn({ method: 'POST' })
  .inputValidator(trialStartSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const [settings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, data.tenantId))
      .limit(1)

    // One trial per tenant — platform admin can reset manually in DB
    // if there's a genuine need.
    if (settings?.trialUsed) {
      throw new Error(
        'Tenant sudah pernah trial. Trial hanya bisa dilakukan sekali.',
      )
    }

    // Block starting a trial on top of an active paid subscription.
    // Confusing — admin should deactivate first if this really makes sense.
    const now = new Date()
    if (
      settings?.subscriptionActive &&
      settings.subscriptionExpiresAt &&
      new Date(settings.subscriptionExpiresAt).getTime() > now.getTime()
    ) {
      throw new Error(
        'Langganan berbayar masih aktif. Nonaktifkan dulu sebelum memulai trial.',
      )
    }

    const durationDays = data.durationDays ?? ATTENDANCE_TRIAL_DEFAULTS.durationDays
    const staffCap =
      data.staffCap === undefined ? ATTENDANCE_TRIAL_DEFAULTS.staffCap : data.staffCap
    const capLabel = staffCap === null ? 'tanpa batas staf' : `batas ${staffCap} staf`
    const trialStartedAt = now
    const trialEndsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: MODULE_KEY_ATTENDANCE,
          planKey: TRIAL_PLAN.key,
          periodStartAt: trialStartedAt,
          periodEndAt: trialEndsAt,
          amountIdr: '0',
          transferDate: now.toISOString().slice(0, 10),
          billedStaffCount: staffCap,
          notes: `Trial gratis — ${durationDays} hari, ${capLabel}`,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // Upsert attendance_settings with trial columns only. Keep the
      // subscription_* columns untouched — paid + trial are orthogonal.
      await tx
        .insert(attendanceSettings)
        .values({
          tenantId: data.tenantId,
          trialStartedAt,
          trialEndsAt,
          trialStaffCap: staffCap,
          trialUsed: true,
        })
        .onConflictDoUpdate({
          target: attendanceSettings.tenantId,
          set: {
            trialStartedAt,
            trialEndsAt,
            trialStaffCap: staffCap,
            trialUsed: true,
            updatedAt: now,
          },
        })

      // Ensure the module is in activeModules so the first-level check
      // in requireActiveModule passes. Idempotent.
      const activeModules = tenant.activeModules ?? []
      if (!activeModules.includes(MODULE_KEY_ATTENDANCE)) {
        await tx
          .update(tenants)
          .set({
            activeModules: [...activeModules, MODULE_KEY_ATTENDANCE],
            updatedAt: now,
          })
          .where(eq(tenants.id, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'attendance_trial_start',
        targetTenantId: data.tenantId,
        metadata: {
          invoiceNumber,
          durationDays,
          staffCap,
          trialStartedAt: trialStartedAt.toISOString(),
          trialEndsAt: trialEndsAt.toISOString(),
        },
      })

      return {
        transactionId: inserted!.id,
        invoiceNumber,
        trialEndsAt: trialEndsAt.toISOString(),
      }
    })

    // Notify the tenant owner that their trial has started.
    await createNotification({
      userId: tenant.ownerId,
      tenantId: data.tenantId,
      type: NOTIFICATION_TYPES.trialGranted,
      title: 'Trial Diaktifkan',
      body: `Trial modul Absensi untuk ${tenant.businessName} aktif sampai ${result.trialEndsAt.slice(0, 10)}. ${capLabel === 'tanpa batas staf' ? 'Tanpa batas staf.' : `Cap ${staffCap} staf.`}`,
      url: '/attendance',
      sourceKey: data.tenantId,
    })

    return result
  })

const trialUpdateSchema = z
  .object({
    tenantId: z.string().uuid(),
    // ISO date string — must be in the future at the server clock.
    endsAt: z.string().datetime().optional(),
    /** `null` = unlimited cap. Omitted = leave the existing value. */
    staffCap: z.number().int().min(1).max(100).nullable().optional(),
  })
  .refine((d) => d.endsAt !== undefined || d.staffCap !== undefined, {
    message: 'Perubahan kosong — isi masa berlaku atau batas staf',
  })

export const updateTrial = createServerFn({ method: 'POST' })
  .inputValidator(trialUpdateSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [settings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, data.tenantId))
      .limit(1)
    if (!settings?.trialStartedAt) {
      throw new Error('Tenant ini belum memulai trial.')
    }
    const now = new Date()
    const currentEnd = settings.trialEndsAt
      ? new Date(settings.trialEndsAt)
      : null
    if (!currentEnd || currentEnd.getTime() <= now.getTime()) {
      throw new Error('Trial sudah berakhir. Tidak bisa diubah lagi.')
    }

    const newEndsAt = data.endsAt ? new Date(data.endsAt) : currentEnd
    if (newEndsAt.getTime() <= now.getTime()) {
      throw new Error('Tanggal berakhir harus di masa depan.')
    }
    // `staffCap === undefined` means leave-as-is; `null` means switch to unlimited.
    const newStaffCap =
      data.staffCap === undefined ? settings.trialStaffCap : data.staffCap

    await db.transaction(async (tx) => {
      await tx
        .update(attendanceSettings)
        .set({
          trialEndsAt: newEndsAt,
          trialStaffCap: newStaffCap,
          updatedAt: now,
        })
        .where(eq(attendanceSettings.tenantId, data.tenantId))

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'attendance_trial_update',
        targetTenantId: data.tenantId,
        metadata: {
          previousEndsAt: currentEnd.toISOString(),
          previousStaffCap: settings.trialStaffCap,
          newEndsAt: newEndsAt.toISOString(),
          newStaffCap,
        },
      })
    })

    return { success: true as const }
  })

export const endTrial = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [settings] = await db
      .select({
        trialStartedAt: attendanceSettings.trialStartedAt,
        trialEndsAt: attendanceSettings.trialEndsAt,
      })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, data.tenantId))
      .limit(1)
    if (!settings?.trialStartedAt) {
      throw new Error('Tenant ini belum memulai trial.')
    }
    const now = new Date()
    const currentEnd = settings.trialEndsAt
      ? new Date(settings.trialEndsAt)
      : null
    if (!currentEnd || currentEnd.getTime() <= now.getTime()) {
      throw new Error('Trial sudah berakhir.')
    }

    await db.transaction(async (tx) => {
      await tx
        .update(attendanceSettings)
        .set({ trialEndsAt: now, updatedAt: now })
        .where(eq(attendanceSettings.tenantId, data.tenantId))

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'attendance_trial_end',
        targetTenantId: data.tenantId,
        metadata: {
          previousEndsAt: currentEnd.toISOString(),
          endedAt: now.toISOString(),
        },
      })
    })

    // Notify the tenant owner that their trial was ended manually.
    // Same source_key as the scheduler-driven 'expired' notification
    // so the user only sees one — whichever comes first wins.
    const [tenant] = await db
      .select({ ownerId: tenants.ownerId, businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (tenant) {
      await createNotification({
        userId: tenant.ownerId,
        tenantId: data.tenantId,
        type: NOTIFICATION_TYPES.trialExpired,
        title: 'Trial Telah Berakhir',
        body: `Masa trial Absensi untuk ${tenant.businessName} telah dihentikan. Berlangganan untuk mengaktifkan kembali.`,
        url: '/attendance/billing',
        sourceKey: data.tenantId,
      })
    }

    return { success: true as const }
  })

// ─── Inventory module: trial / payment / refund ──────────────────────
//
// Mirrors the attendance flow but flat-priced (no per-staff math) and
// the trial unlocks Toko-tier features regardless of the stored tier.
// All four functions share the existing financial_transactions ledger
// + audit log; only the module key + settings table differ.

const MODULE_KEY_INVENTORY = 'inventory'

export const startInventoryTrial = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      durationDays: z.number().int().min(1).max(30).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const [settings] = await db
      .select()
      .from(inventorySettings)
      .where(eq(inventorySettings.tenantId, data.tenantId))
      .limit(1)

    if (settings?.trialUsed) {
      throw new Error(
        'Tenant sudah pernah trial inventory. Trial hanya bisa dilakukan sekali.',
      )
    }

    const now = new Date()
    if (
      settings?.subscriptionActive &&
      settings.subscriptionExpiresAt &&
      new Date(settings.subscriptionExpiresAt).getTime() > now.getTime()
    ) {
      throw new Error(
        'Langganan Inventory masih aktif. Nonaktifkan dulu sebelum memulai trial.',
      )
    }

    const durationDays =
      data.durationDays ?? INVENTORY_TRIAL_DEFAULTS.durationDays
    const trialStartedAt = now
    const trialEndsAt = new Date(
      now.getTime() + durationDays * 24 * 60 * 60 * 1000,
    )

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: MODULE_KEY_INVENTORY,
          planKey: INVENTORY_TRIAL_PLAN.key,
          periodStartAt: trialStartedAt,
          periodEndAt: trialEndsAt,
          amountIdr: '0',
          transferDate: now.toISOString().slice(0, 10),
          billedStaffCount: 0,
          notes: `Trial Inventory gratis — ${durationDays} hari, fitur Toko`,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // Upsert inventory_settings with trial columns. Don't touch
      // subscription_* — paid + trial coexist.
      await tx
        .insert(inventorySettings)
        .values({
          tenantId: data.tenantId,
          tier: 'toko',
          trialStartedAt,
          trialEndsAt,
          trialUsed: true,
        })
        .onConflictDoUpdate({
          target: inventorySettings.tenantId,
          set: {
            tier: 'toko',
            trialStartedAt,
            trialEndsAt,
            trialUsed: true,
            updatedAt: now,
          },
        })

      // Add `inventory` to activeModules so the module-status badge in
      // the sidebar lights up. Idempotent.
      const activeModules = tenant.activeModules ?? []
      if (!activeModules.includes(MODULE_KEY_INVENTORY)) {
        await tx
          .update(tenants)
          .set({
            activeModules: [...activeModules, MODULE_KEY_INVENTORY],
            updatedAt: now,
          })
          .where(eq(tenants.id, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'inventory_trial_start',
        targetTenantId: data.tenantId,
        metadata: {
          invoiceNumber,
          durationDays,
          trialStartedAt: trialStartedAt.toISOString(),
          trialEndsAt: trialEndsAt.toISOString(),
        },
      })

      return {
        transactionId: inserted!.id,
        invoiceNumber,
        trialEndsAt: trialEndsAt.toISOString(),
      }
    })

    await createNotification({
      userId: tenant.ownerId,
      tenantId: data.tenantId,
      type: NOTIFICATION_TYPES.inventoryTrialGranted,
      title: 'Trial Inventory Diaktifkan',
      body: `Trial modul Inventory untuk ${tenant.businessName} aktif sampai ${result.trialEndsAt.slice(0, 10)} dengan fitur Toko terbuka.`,
      url: '/inventory',
      sourceKey: data.tenantId,
    })

    return result
  })

export const endInventoryTrial = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [settings] = await db
      .select()
      .from(inventorySettings)
      .where(eq(inventorySettings.tenantId, data.tenantId))
      .limit(1)
    if (!settings?.trialStartedAt) {
      throw new Error('Tenant ini belum memulai trial inventory.')
    }
    const now = new Date()
    const currentEnd = settings.trialEndsAt
      ? new Date(settings.trialEndsAt)
      : null
    if (!currentEnd || currentEnd.getTime() <= now.getTime()) {
      throw new Error('Trial inventory sudah berakhir.')
    }

    await db.transaction(async (tx) => {
      await tx
        .update(inventorySettings)
        .set({ trialEndsAt: now, updatedAt: now })
        .where(eq(inventorySettings.tenantId, data.tenantId))

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'inventory_trial_end',
        targetTenantId: data.tenantId,
        metadata: {
          previousEndsAt: currentEnd.toISOString(),
          endedAt: now.toISOString(),
        },
      })
    })

    const [tenant] = await db
      .select({ ownerId: tenants.ownerId, businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (tenant) {
      await createNotification({
        userId: tenant.ownerId,
        tenantId: data.tenantId,
        type: NOTIFICATION_TYPES.inventoryTrialExpired,
        title: 'Trial Inventory Telah Berakhir',
        body: `Masa trial Inventory untuk ${tenant.businessName} telah dihentikan. Berlangganan untuk mengaktifkan kembali fitur Toko.`,
        url: '/inventory/billing',
        sourceKey: data.tenantId,
      })
    }

    return { success: true as const }
  })

const recordInventoryPaymentSchema = z.object({
  tenantId: z.string().uuid(),
  planKey: z
    .string()
    .refine((k) => INVENTORY_PLANS.some((p) => p.key === k && !p.comingSoon), {
      message: 'Paket tidak valid',
    }),
  // Number of inventory-enabled branches this payment covers. Defaults
  // to 1 so the old "single location" workflow stays correct without a
  // form update. Multi-location chains bill base + (N-1)×additional
  // per month — `inventoryTotal` does the math.
  locationCount: z.number().int().min(1).max(100).default(1),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankReference: z.string().max(200).optional(),
  proofDataUrl: z.string().optional(),
  notes: z.string().max(1000).optional(),
})

export const recordInventoryPaymentAndActivate = createServerFn({
  method: 'POST',
})
  .inputValidator(recordInventoryPaymentSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const plan = findInventoryPlan(data.planKey)
    if (!plan) throw new Error('Paket tidak ditemukan')
    const locationCount = data.locationCount ?? 1
    const amountIdr = inventoryTotal(data.planKey, locationCount)

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    // Compute new period: extend from existing expiry if currently
    // active, else start "now".
    const [settings] = await db
      .select({
        currentExpiry: inventorySettings.subscriptionExpiresAt,
        active: inventorySettings.subscriptionActive,
      })
      .from(inventorySettings)
      .where(eq(inventorySettings.tenantId, data.tenantId))
      .limit(1)

    const now = new Date()
    const periodStart =
      settings?.active &&
      settings.currentExpiry &&
      new Date(settings.currentExpiry).getTime() > now.getTime()
        ? new Date(settings.currentExpiry)
        : now
    const periodEnd = addMonths(periodStart, plan.durationMonths)

    let proofKey: string | null = null
    if (data.proofDataUrl) {
      const parsed = parseDataUrl(data.proofDataUrl)
      if (parsed) {
        proofKey = await uploadFinancialProof({
          tenantId: data.tenantId,
          invoiceNumber: 'tmp', // will be overwritten below
          bytes: parsed.bytes,
          mimeType: parsed.mimeType,
        }).then((r) => r.key)
      }
    }

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      // JUR-96: apply referral discount server-side (no-op when the
      // tenant has no active attribution).
      const { finalAmountIdr } = await applyReferralDiscount({
        tx,
        refereeTenantId: data.tenantId,
        fullAmountIdr: amountIdr,
      })

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: MODULE_KEY_INVENTORY,
          planKey: data.planKey,
          periodStartAt: periodStart,
          periodEndAt: periodEnd,
          amountIdr: finalAmountIdr.toString(),
          transferDate: data.transferDate,
          bankReference: data.bankReference ?? null,
          proofPhotoKey: proofKey,
          billedStaffCount: 0,
          // Re-use the POS billedOutletCount column for inventory's
          // billed-location count — drift indicator reads this back.
          // No new column needed; the semantics are "billable units of
          // the relevant physical-location dimension for this module".
          billedOutletCount: locationCount,
          notes: data.notes ?? null,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // JUR-94: credit referral commission if applicable.
      await creditReferralCommissionIfApplicable({
        tx,
        refereeTenantId: data.tenantId,
        amountIdr: inserted!.amountIdr,
        invoiceId: inserted!.id,
      })

      await tx
        .insert(inventorySettings)
        .values({
          tenantId: data.tenantId,
          tier: plan.tier,
          subscriptionActive: true,
          // Fresh-insert path: started_at = today. For an UPDATE
          // (existing row), the onConflictDoUpdate set below
          // intentionally omits started_at so the original first
          // activation date stays preserved (audit trail integrity).
          subscriptionStartedAt: now,
          subscriptionExpiresAt: periodEnd,
        })
        .onConflictDoUpdate({
          target: inventorySettings.tenantId,
          set: {
            tier: plan.tier,
            subscriptionActive: true,
            subscriptionExpiresAt: periodEnd,
            updatedAt: now,
          },
        })

      const activeModules = tenant.activeModules ?? []
      if (!activeModules.includes(MODULE_KEY_INVENTORY)) {
        await tx
          .update(tenants)
          .set({
            activeModules: [...activeModules, MODULE_KEY_INVENTORY],
            updatedAt: now,
          })
          .where(eq(tenants.id, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'inventory_record_payment',
        targetTenantId: data.tenantId,
        metadata: {
          invoiceNumber,
          planKey: data.planKey,
          amountIdr,
          periodStartAt: periodStart.toISOString(),
          periodEndAt: periodEnd.toISOString(),
        },
      })

      return {
        transactionId: inserted!.id,
        invoiceNumber,
        amountIdr,
        periodStartAt: periodStart.toISOString(),
        periodEndAt: periodEnd.toISOString(),
      }
    })

    await createNotification({
      userId: tenant.ownerId,
      tenantId: data.tenantId,
      type: NOTIFICATION_TYPES.inventoryPaymentReceived,
      title: 'Pembayaran Inventory Diterima',
      body: `Pembayaran Inventory untuk ${tenant.businessName} berhasil diproses. Aktif sampai ${result.periodEndAt.slice(0, 10)}.`,
      url: '/inventory/billing',
      sourceKey: result.transactionId,
    })

    // Email receipt
    const ownerEmail = await getUserEmail(tenant.ownerId)
    if (ownerEmail) {
      const tpl = buildPaymentReceiptEmail({
        tenantName: tenant.businessName,
        invoiceNumber: result.invoiceNumber,
        planLabel: PLAN_LABEL_ID[plan.labelKey] ?? plan.labelKey,
        periodStart: result.periodStartAt,
        periodEnd: result.periodEndAt,
        billedStaffCount: 0,
        amountIdr: result.amountIdr,
        paidDate: data.transferDate,
        bankReference: data.bankReference,
        billingUrl: `${APP_URL}/inventory/billing`,
      })
      await sendEmail({
        to: ownerEmail,
        toName: tenant.businessName,
        subject: tpl.subject,
        htmlContent: tpl.htmlContent,
        textContent: tpl.textContent,
        tag: 'inventory-payment-receipt',
      })
    }

    return result
  })


// ─── POS module (admin) ──────────────────────────────
// Mirrors the inventory flow: flat-priced, trial unlocks Toko-tier
// features regardless of stored tier, ledger row at amount=0 on trial
// start, ledger row at full price on payment. Uses the same
// activeModules + financial_transactions tables.

const MODULE_KEY_POS = 'pos'

export const startPOSTrial = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      durationDays: z.number().int().min(1).max(30).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const [settings] = await db
      .select()
      .from(posSettings)
      .where(eq(posSettings.tenantId, data.tenantId))
      .limit(1)

    if (settings?.trialUsed) {
      throw new Error(
        'Tenant sudah pernah trial Kasir. Trial hanya bisa dilakukan sekali.',
      )
    }

    const now = new Date()
    if (
      settings?.subscriptionActive &&
      settings.subscriptionExpiresAt &&
      new Date(settings.subscriptionExpiresAt).getTime() > now.getTime()
    ) {
      throw new Error(
        'Langganan Kasir masih aktif. Nonaktifkan dulu sebelum memulai trial.',
      )
    }

    const durationDays =
      data.durationDays ?? POS_TRIAL_DEFAULTS.durationDays
    const trialStartedAt = now
    const trialEndsAt = new Date(
      now.getTime() + durationDays * 24 * 60 * 60 * 1000,
    )

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: MODULE_KEY_POS,
          planKey: POS_TRIAL_PLAN.key,
          periodStartAt: trialStartedAt,
          periodEndAt: trialEndsAt,
          amountIdr: '0',
          transferDate: now.toISOString().slice(0, 10),
          billedStaffCount: 0,
          notes: `Trial Kasir gratis — ${durationDays} hari, fitur Toko`,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // Upsert pos_settings with trial columns. Don't touch
      // subscription_* — paid + trial coexist.
      await tx
        .insert(posSettings)
        .values({
          tenantId: data.tenantId,
          tier: 'toko',
          trialStartedAt,
          trialEndsAt,
          trialUsed: true,
        })
        .onConflictDoUpdate({
          target: posSettings.tenantId,
          set: {
            tier: 'toko',
            trialStartedAt,
            trialEndsAt,
            trialUsed: true,
            updatedAt: now,
          },
        })

      // Add `pos` to activeModules so the sidebar status badge lights up.
      const activeModules = tenant.activeModules ?? []
      if (!activeModules.includes(MODULE_KEY_POS)) {
        await tx
          .update(tenants)
          .set({
            activeModules: [...activeModules, MODULE_KEY_POS],
            updatedAt: now,
          })
          .where(eq(tenants.id, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'pos_trial_start',
        targetTenantId: data.tenantId,
        metadata: {
          invoiceNumber,
          durationDays,
          trialStartedAt: trialStartedAt.toISOString(),
          trialEndsAt: trialEndsAt.toISOString(),
        },
      })

      return {
        transactionId: inserted!.id,
        invoiceNumber,
        trialEndsAt: trialEndsAt.toISOString(),
      }
    })

    await createNotification({
      userId: tenant.ownerId,
      tenantId: data.tenantId,
      type: NOTIFICATION_TYPES.posTrialGranted,
      title: 'Trial Kasir Diaktifkan',
      body: `Trial modul Kasir untuk ${tenant.businessName} aktif sampai ${result.trialEndsAt.slice(0, 10)} dengan fitur Toko terbuka.`,
      url: '/pos',
      sourceKey: data.tenantId,
    })

    return result
  })

export const endPOSTrial = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [settings] = await db
      .select()
      .from(posSettings)
      .where(eq(posSettings.tenantId, data.tenantId))
      .limit(1)
    if (!settings?.trialStartedAt) {
      throw new Error('Tenant ini belum memulai trial Kasir.')
    }
    const now = new Date()
    const currentEnd = settings.trialEndsAt
      ? new Date(settings.trialEndsAt)
      : null
    if (!currentEnd || currentEnd.getTime() <= now.getTime()) {
      throw new Error('Trial Kasir sudah berakhir.')
    }

    await db.transaction(async (tx) => {
      await tx
        .update(posSettings)
        .set({ trialEndsAt: now, updatedAt: now })
        .where(eq(posSettings.tenantId, data.tenantId))

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'pos_trial_end',
        targetTenantId: data.tenantId,
        metadata: {
          previousEndsAt: currentEnd.toISOString(),
          endedAt: now.toISOString(),
        },
      })
    })

    const [tenant] = await db
      .select({ ownerId: tenants.ownerId, businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (tenant) {
      await createNotification({
        userId: tenant.ownerId,
        tenantId: data.tenantId,
        type: NOTIFICATION_TYPES.posTrialExpired,
        title: 'Trial Kasir Telah Berakhir',
        body: `Masa trial Kasir untuk ${tenant.businessName} telah dihentikan. Berlangganan untuk mengaktifkan kembali fitur Toko.`,
        url: '/pos/billing',
        sourceKey: data.tenantId,
      })
    }

    return { success: true as const }
  })

const recordPOSPaymentSchema = z.object({
  tenantId: z.string().uuid(),
  planKey: z
    .string()
    .refine((k) => POS_PLANS.some((p) => p.key === k && !p.comingSoon), {
      message: 'Paket tidak valid',
    }),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankReference: z.string().max(200).optional(),
  proofDataUrl: z.string().optional(),
  notes: z.string().max(1000).optional(),
  /**
   * How many outlets the payment covers. The first outlet is included
   * in the plan's base price; each additional outlet adds the plan's
   * `additionalOutletPerMonth × durationMonths`. Defaults to 1 (the
   * majority single-warung case) so old callers keep working.
   */
  outletCount: z.number().int().min(1).max(100).default(1),
})

export const recordPOSPaymentAndActivate = createServerFn({
  method: 'POST',
})
  .inputValidator(recordPOSPaymentSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const plan = findPOSPlan(data.planKey)
    if (!plan) throw new Error('Paket tidak ditemukan')
    const outletCount = data.outletCount ?? 1
    const amountIdr = posTotal(data.planKey, outletCount)

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const [settings] = await db
      .select({
        currentExpiry: posSettings.subscriptionExpiresAt,
        active: posSettings.subscriptionActive,
      })
      .from(posSettings)
      .where(eq(posSettings.tenantId, data.tenantId))
      .limit(1)

    const now = new Date()
    const isKomplitBundle = plan.tier === 'komplit'

    // For Komplit, the period must respect the LONGEST unexpired
    // subscription across POS + Inventory + Attendance — otherwise we
    // overwrite an already-paid-for expiry and the tenant loses time.
    // For pure POS plans (Toko monthly/annual), only POS expiry matters.
    let periodStart = now
    if (settings?.active && settings.currentExpiry) {
      const ts = new Date(settings.currentExpiry).getTime()
      if (ts > periodStart.getTime()) periodStart = new Date(ts)
    }
    if (isKomplitBundle) {
      const [invSettings] = await db
        .select({
          active: inventorySettings.subscriptionActive,
          expiry: inventorySettings.subscriptionExpiresAt,
        })
        .from(inventorySettings)
        .where(eq(inventorySettings.tenantId, data.tenantId))
        .limit(1)
      const [attSettings] = await db
        .select({
          active: attendanceSettings.subscriptionActive,
          expiry: attendanceSettings.subscriptionExpiresAt,
        })
        .from(attendanceSettings)
        .where(eq(attendanceSettings.tenantId, data.tenantId))
        .limit(1)
      for (const s of [invSettings, attSettings]) {
        if (s?.active && s.expiry) {
          const ts = new Date(s.expiry).getTime()
          if (ts > periodStart.getTime()) periodStart = new Date(ts)
        }
      }
    }
    const periodEnd = addMonths(periodStart, plan.durationMonths)

    let proofKey: string | null = null
    if (data.proofDataUrl) {
      const parsed = parseDataUrl(data.proofDataUrl)
      if (parsed) {
        proofKey = await uploadFinancialProof({
          tenantId: data.tenantId,
          invoiceNumber: 'tmp',
          bytes: parsed.bytes,
          mimeType: parsed.mimeType,
        }).then((r) => r.key)
      }
    }

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      // JUR-96: apply referral discount server-side.
      const { finalAmountIdr } = await applyReferralDiscount({
        tx,
        refereeTenantId: data.tenantId,
        fullAmountIdr: amountIdr,
      })

      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: MODULE_KEY_POS,
          planKey: data.planKey,
          periodStartAt: periodStart,
          periodEndAt: periodEnd,
          amountIdr: finalAmountIdr.toString(),
          transferDate: data.transferDate,
          bankReference: data.bankReference ?? null,
          proofPhotoKey: proofKey,
          billedStaffCount: 0,
          billedOutletCount: outletCount,
          notes: data.notes ?? null,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // JUR-94: credit referral commission if applicable.
      await creditReferralCommissionIfApplicable({
        tx,
        refereeTenantId: data.tenantId,
        amountIdr: inserted!.amountIdr,
        invoiceId: inserted!.id,
      })

      await tx
        .insert(posSettings)
        .values({
          tenantId: data.tenantId,
          tier: plan.tier,
          subscriptionActive: true,
          // Fresh-insert: started_at = today. The onConflictDoUpdate
          // set below intentionally omits started_at so the original
          // first-activation date is preserved on existing rows.
          subscriptionStartedAt: now,
          subscriptionExpiresAt: periodEnd,
        })
        .onConflictDoUpdate({
          target: posSettings.tenantId,
          set: {
            tier: plan.tier,
            subscriptionActive: true,
            subscriptionExpiresAt: periodEnd,
            updatedAt: now,
          },
        })

      // Komplit bundle (JUR-5b): one payment activates POS +
      // Inventory + Attendance simultaneously. Inventory comes in at
      // 'toko' tier (multi-unit, PO, alerts, HPP sync — same as the
      // standalone Inventory Toko subscription). Attendance flips on
      // with the same period; staff count is unbilled (the bundle
      // includes "unlimited staff" per the marketing copy, so the
      // per-staff billing skip is intentional).
      //
      // periodStart / periodEnd were computed above with respect to the
      // LONGEST existing expiry across all 3 modules — so a tenant who
      // already paid for Attendance through May 15 will see the Komplit
      // period start at May 15 (not today), preserving every paid day.
      if (isKomplitBundle) {
        await tx
          .insert(inventorySettings)
          .values({
            tenantId: data.tenantId,
            tier: 'toko',
            subscriptionActive: true,
            subscriptionStartedAt: now,
            subscriptionExpiresAt: periodEnd,
          })
          .onConflictDoUpdate({
            target: inventorySettings.tenantId,
            set: {
              tier: 'toko',
              subscriptionActive: true,
              // started_at intentionally omitted — preserve the
              // original Inventory activation date if the row already
              // exists. Komplit only EXTENDS the expiry, not the start.
              subscriptionExpiresAt: periodEnd,
              updatedAt: now,
            },
          })

        await tx
          .insert(attendanceSettings)
          .values({
            tenantId: data.tenantId,
            subscriptionActive: true,
            subscriptionStartedAt: now,
            subscriptionExpiresAt: periodEnd,
            // billedStaffCount = 0 sentinel: Komplit doesn't pay
            // per-staff. Attendance access middleware only checks
            // subscriptionActive + expiry, so staff count is
            // effectively unlimited for bundled subscriptions.
            billedStaffCount: 0,
          })
          .onConflictDoUpdate({
            target: attendanceSettings.tenantId,
            set: {
              subscriptionActive: true,
              // Same as above — preserve original Attendance start.
              subscriptionExpiresAt: periodEnd,
              billedStaffCount: 0,
              updatedAt: now,
            },
          })

        // Welcome gift: 3 free Konten credits on the tenant's FIRST paid
        // Komplit activation. Idempotency lives in the konten ledger so
        // cancel + re-subscribe does NOT trigger another grant.
        await grantKontenSignupCreditsOnce(tx, {
          tenantId: data.tenantId,
          createdBy: auth.userId,
        })
      }

      const activeModules = tenant.activeModules ?? []
      const newModules = new Set(activeModules)
      newModules.add(MODULE_KEY_POS)
      if (isKomplitBundle) {
        newModules.add(MODULE_KEY_INVENTORY)
        newModules.add(MODULE_KEY_ATTENDANCE)
      }
      if (newModules.size !== activeModules.length) {
        await tx
          .update(tenants)
          .set({
            activeModules: Array.from(newModules),
            updatedAt: now,
          })
          .where(eq(tenants.id, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'pos_record_payment',
        targetTenantId: data.tenantId,
        metadata: {
          invoiceNumber,
          planKey: data.planKey,
          amountIdr,
          outletCount,
          periodStartAt: periodStart.toISOString(),
          periodEndAt: periodEnd.toISOString(),
        },
      })

      return {
        transactionId: inserted!.id,
        invoiceNumber,
        amountIdr,
        outletCount,
        periodStartAt: periodStart.toISOString(),
        periodEndAt: periodEnd.toISOString(),
      }
    })

    await createNotification({
      userId: tenant.ownerId,
      tenantId: data.tenantId,
      type: NOTIFICATION_TYPES.posPaymentReceived,
      title: 'Pembayaran Kasir Diterima',
      body: `Pembayaran Kasir untuk ${tenant.businessName} (${result.outletCount} outlet) berhasil diproses. Aktif sampai ${result.periodEndAt.slice(0, 10)}.`,
      url: '/pos/billing',
      sourceKey: result.transactionId,
    })

    const ownerEmail = await getUserEmail(tenant.ownerId)
    if (ownerEmail) {
      const tpl = buildPaymentReceiptEmail({
        tenantName: tenant.businessName,
        invoiceNumber: result.invoiceNumber,
        planLabel: PLAN_LABEL_ID[plan.labelKey] ?? plan.labelKey,
        periodStart: result.periodStartAt,
        periodEnd: result.periodEndAt,
        billedStaffCount: 0,
        amountIdr: result.amountIdr,
        paidDate: data.transferDate,
        bankReference: data.bankReference,
        billingUrl: `${APP_URL}/pos/billing`,
      })
      await sendEmail({
        to: ownerEmail,
        toName: tenant.businessName,
        subject: tpl.subject,
        htmlContent: tpl.htmlContent,
        textContent: tpl.textContent,
        tag: 'pos-payment-receipt',
      })
    }

    return result
  })

// ─── WA Subscription payment ─────────────────────────────────────────────────

export const recordWaPayment = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      // 'enterprise' + 'pro' tiers exist in the DB but are
      // is_active=false until those tiers are actually built. Keep
      // the enum tight to the activatable tiers so admins can't
      // accidentally activate something unsupported.
      planKey: z.enum(['basic', 'komplit']),
      amountIdr: z.number().int().positive(),
      // 1 = monthly, 12 = annual. Drives the subscription expiry span.
      durationMonths: z.union([z.literal(1), z.literal(12)]).default(1),
      transferDate: dateStr,
      bankReference: z.string().max(200).optional(),
      proofDataUrl: z.string().optional(),
      notes: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const [waSub] = await db.execute(sql`
      SELECT subscription_active, subscription_expires_at
      FROM wa_settings
      WHERE tenant_id = ${data.tenantId}
    `) as any[]

    const now = new Date()
    const currentExpiry = waSub?.[0]?.subscription_expires_at ? new Date(waSub[0].subscription_expires_at) : null
    const hasActive = !!(waSub?.[0]?.subscription_active) && currentExpiry != null && currentExpiry.getTime() > now.getTime()
    const periodStart = hasActive ? currentExpiry! : now
    const periodEnd = addMonths(periodStart, data.durationMonths)

    let proofKey: string | null = null
    if (data.proofDataUrl) {
      const { bytes, mimeType } = parseDataUrl(data.proofDataUrl)
      const tempKey = crypto.randomUUID()
      const { key } = await uploadFinancialProof({
        tenantId: data.tenantId,
        invoiceNumber: tempKey,
        bytes,
        mimeType,
      })
      proofKey = key
    }

    const result = await db.transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx as any, now)

      // JUR-193: WhatsApp is an add-on module — the referral discount
      // and commission apply only to the core packages (POS / Inventory
      // / Attendance). A WhatsApp payment is recorded at full price
      // with no referral attribution.
      const [inserted] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber,
          moduleKey: 'whatsapp',
          planKey: data.planKey,
          periodStartAt: periodStart,
          periodEndAt: periodEnd,
          amountIdr: data.amountIdr.toString(),
          transferDate: data.transferDate,
          bankReference: data.bankReference ?? null,
          proofPhotoKey: proofKey,
          notes: data.notes ?? null,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // Upsert wa_settings with new tier + expiry
      await tx.execute(sql`
        INSERT INTO wa_settings (tenant_id, tier, subscription_active, subscription_expires_at, updated_at)
        VALUES (${data.tenantId}, ${data.planKey}, true, ${periodEnd.toISOString()}, now())
        ON CONFLICT (tenant_id) DO UPDATE SET
          tier = EXCLUDED.tier,
          subscription_active = true,
          subscription_expires_at = EXCLUDED.subscription_expires_at,
          updated_at = now()
      `)

      // Ensure 'whatsapp' is in activeModules
      await tx.execute(sql`
        UPDATE tenants
        SET active_modules = array(SELECT DISTINCT unnest(array_append(active_modules, 'whatsapp')))
        WHERE id = ${data.tenantId}
          AND NOT ('whatsapp' = ANY(active_modules))
      `)

      return { ...inserted!, amountIdr: Number(inserted!.amountIdr) }
    })

    return result
  })

export const deactivateWa = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select({ activeModules: tenants.activeModules })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const newModules = (tenant.activeModules ?? []).filter((m) => m !== 'whatsapp')

    await db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({ activeModules: newModules, updatedAt: new Date() })
        .where(eq(tenants.id, data.tenantId))

      await tx.execute(sql`
        UPDATE wa_settings
        SET subscription_active = false, updated_at = now()
        WHERE tenant_id = ${data.tenantId}
      `)

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'wa_deactivate',
        targetTenantId: data.tenantId,
      })
    })

    return { success: true }
  })

/**
 * Branch-billing drift report for a tenant. Compares the
 * billedOutletCount on the LATEST paid POS / Inventory transactions
 * against the actual count of branches with that module enabled. The
 * delta is what the admin needs to bump at next-renewal — surfaced as
 * a card on the tenant detail page so they don't forget.
 *
 * Returns null per module when no paid transaction exists yet for it
 * (e.g. tenant still on free, or first activation hasn't happened).
 * Returns 0 drift when activeBranches matches lastBilledCount, in
 * which case the UI hides the card entirely.
 */
export const getTenantBranchBillingDrift = createServerFn({
  method: 'POST',
})
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [posLast, invLast, posActiveRow, invActiveRow] = await Promise.all([
      // Latest paid POS transaction so we know what outletCount was on
      // the most-recent invoice. Refunds aren't billed-count-relevant.
      db
        .select({
          planKey: financialTransactions.planKey,
          billedOutletCount: financialTransactions.billedOutletCount,
          periodEndAt: financialTransactions.periodEndAt,
        })
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.tenantId, data.tenantId),
            eq(financialTransactions.moduleKey, 'pos'),
            eq(financialTransactions.status, 'paid'),
          ),
        )
        .orderBy(desc(financialTransactions.createdAt))
        .limit(1),
      db
        .select({
          planKey: financialTransactions.planKey,
          billedOutletCount: financialTransactions.billedOutletCount,
          periodEndAt: financialTransactions.periodEndAt,
        })
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.tenantId, data.tenantId),
            eq(financialTransactions.moduleKey, 'inventory'),
            eq(financialTransactions.status, 'paid'),
          ),
        )
        .orderBy(desc(financialTransactions.createdAt))
        .limit(1),
      db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, data.tenantId),
            sql`'pos' = ANY(${branches.enabledModules})`,
          ),
        ),
      db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, data.tenantId),
            sql`'inventory' = ANY(${branches.enabledModules})`,
          ),
        ),
    ])

    const posActive = posActiveRow[0]?.count ?? 0
    const invActive = invActiveRow[0]?.count ?? 0

    function moduleDrift(
      moduleKey: 'pos' | 'inventory',
      lastTx: typeof posLast,
      activeCount: number,
    ) {
      if (lastTx.length === 0) {
        return null
      }
      const last = lastTx[0]!
      const billed = last.billedOutletCount ?? 1
      const delta = activeCount - billed
      if (delta <= 0) {
        // Drift is only meaningful when actual > billed (owner added
        // branches between renewals). Negative drift (removed branches)
        // doesn't auto-refund — admin handles ad-hoc.
        return {
          planKey: last.planKey,
          billed,
          active: activeCount,
          delta: 0,
          extraPerMonth: 0,
          periodEndAt: last.periodEndAt,
        }
      }
      // Compute how much one extra billed location costs at the
      // current plan, then multiply by delta. posTotal / inventoryTotal
      // are linear in count so we can derive the per-extra price
      // straight from them.
      const totalAtBilled =
        moduleKey === 'pos'
          ? posTotal(last.planKey, billed)
          : inventoryTotal(last.planKey, billed)
      const totalAtActive =
        moduleKey === 'pos'
          ? posTotal(last.planKey, activeCount)
          : inventoryTotal(last.planKey, activeCount)
      // The amount is for the whole subscription period; per-month is
      // amount / durationMonths from the plan.
      const plan =
        moduleKey === 'pos'
          ? findPOSPlan(last.planKey)
          : findInventoryPlan(last.planKey)
      const months = plan?.durationMonths ?? 1
      const extraPerMonth = Math.max(
        0,
        Math.round((totalAtActive - totalAtBilled) / months),
      )
      return {
        planKey: last.planKey,
        billed,
        active: activeCount,
        delta,
        extraPerMonth,
        periodEndAt: last.periodEndAt,
      }
    }

    return {
      pos: moduleDrift('pos', posLast, posActive),
      inventory: moduleDrift('inventory', invLast, invActive),
    }
  })

// ─── Additional outlet payment (mid-period prorated) ────────────────
//
// When a tenant on a paid module wants to add more outlets between
// renewals, admin records this partial-period payment. It does NOT
// extend the subscription period — it just covers the extra outlets
// for whatever's left of the current paid window, then bumps the
// `billedOutletCount` so the tenant's hard-block / drift card update.
//
// The "package" param disambiguates what the new outlet covers — for
// a Komplit tenant adding a full-bundle outlet, the Komplit annual
// rate (Rp 45k/mo) is the all-inclusive bundled price. Charging the
// POS rate + Inventory rate separately would double-count.

type OutletPackageOption = {
  packageKey: 'komplit' | 'pos-only' | 'inventory-only'
  label: string
  description: string
  /** IDR per month per outlet — what gets billed. */
  ratePerMonth: number
  /** First-outlet price for comparison ("hemat X%" math). */
  firstOutletPricePerMonth: number
  /** True if this option bumps billed counts on multiple modules. */
  bundled: boolean
}

/**
 * Read everything the AdditionalOutletSheet needs to render the
 * package picker + cost preview: the months remaining until the
 * subscription expires, current billed counts per module, and the
 * package options available for THIS tenant based on which modules
 * they have paid+active.
 */
export const getAdditionalOutletContext = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    // Latest paid per module gives us planKey (annual vs monthly →
    // different additional rates), billed count, and the period end.
    const [posLast] = await db
      .select({
        planKey: financialTransactions.planKey,
        billedOutletCount: financialTransactions.billedOutletCount,
        periodEndAt: financialTransactions.periodEndAt,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.tenantId, data.tenantId),
          eq(financialTransactions.moduleKey, 'pos'),
          eq(financialTransactions.status, 'paid'),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt))
      .limit(1)

    const [invLast] = await db
      .select({
        planKey: financialTransactions.planKey,
        billedOutletCount: financialTransactions.billedOutletCount,
        periodEndAt: financialTransactions.periodEndAt,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.tenantId, data.tenantId),
          eq(financialTransactions.moduleKey, 'inventory'),
          eq(financialTransactions.status, 'paid'),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt))
      .limit(1)

    if (!posLast && !invLast) {
      return { hasActive: false as const }
    }

    function monthsLeft(periodEndAt: Date | null): number {
      if (!periodEndAt) return 0
      const ms = Math.max(0, periodEndAt.getTime() - Date.now())
      if (ms === 0) return 0
      return Math.max(1, Math.ceil(ms / (30 * 24 * 60 * 60 * 1000)))
    }

    const posMonths = monthsLeft(posLast?.periodEndAt ?? null)
    const invMonths = monthsLeft(invLast?.periodEndAt ?? null)
    const posPlan = posLast ? findPOSPlan(posLast.planKey) : null
    const invPlan = invLast ? findInventoryPlan(invLast.planKey) : null

    const options: OutletPackageOption[] = []

    // Komplit bundle option — only when POS is on a Komplit plan.
    // The Komplit additional rate covers POS+Inv+Att in one line.
    if (posPlan && posPlan.tier === 'komplit' && posMonths > 0) {
      options.push({
        packageKey: 'komplit',
        label: 'Outlet Komplit (Bundle)',
        description:
          'Full bundle POS + Inventory + Absensi + HPP. Tarif bundled — paling hemat untuk outlet penuh.',
        ratePerMonth: posPlan.additionalOutletPerMonth ?? 0,
        firstOutletPricePerMonth: posPlan.pricePerMonth,
        bundled: true,
      })
    }

    // POS-only option — when POS is active and either non-Komplit OR
    // we still want to allow POS-only kiosk-style outlets on Komplit.
    if (posPlan && posMonths > 0) {
      // For Komplit tenants, POS-only à la carte uses Toko rates;
      // for à la carte tenants, it uses their current plan rates.
      const ratesPlan =
        posPlan.tier === 'komplit'
          ? POS_PLANS.find(
              (p) =>
                p.tier === 'toko' &&
                p.durationMonths === posPlan.durationMonths,
            ) ?? null
          : posPlan
      if (ratesPlan) {
        options.push({
          packageKey: 'pos-only',
          label: 'POS Only (Kasir saja)',
          description:
            'Outlet hanya pakai modul Kasir. Cocok untuk kiosk / drive-through tanpa inventaris terpisah.',
          ratePerMonth: ratesPlan.additionalOutletPerMonth ?? 0,
          firstOutletPricePerMonth: ratesPlan.pricePerMonth,
          bundled: false,
        })
      }
    }

    // Inventory-only / Gudang option.
    if (invPlan && invMonths > 0) {
      options.push({
        packageKey: 'inventory-only',
        label: 'Gudang / Inventory Only',
        description:
          'Lokasi penyimpanan saja — tidak ada transaksi POS atau check-in staf. Paling murah.',
        ratePerMonth: invPlan.additionalLocationPerMonth ?? 0,
        firstOutletPricePerMonth: invPlan.pricePerMonth,
        bundled: false,
      })
    }

    return {
      hasActive: true as const,
      options,
      currentBilledOutletCount: {
        pos: posLast?.billedOutletCount ?? 0,
        inventory: invLast?.billedOutletCount ?? 0,
      },
      monthsRemaining: {
        pos: posMonths,
        inventory: invMonths,
      },
      periodEndAt: {
        pos: posLast?.periodEndAt
          ? new Date(posLast.periodEndAt).toISOString()
          : null,
        inventory: invLast?.periodEndAt
          ? new Date(invLast.periodEndAt).toISOString()
          : null,
      },
      // Echo the planKeys so the sheet can show "Komplit Tahunan" etc.
      planKeys: {
        pos: posLast?.planKey ?? null,
        inventory: invLast?.planKey ?? null,
      },
    }
  })

const recordAdditionalOutletSchema = z.object({
  tenantId: z.string().uuid(),
  packageKey: z.enum(['komplit', 'pos-only', 'inventory-only']),
  additionalOutletCount: z.number().int().min(1).max(50),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankReference: z.string().max(200).optional(),
  proofDataUrl: z.string().optional(),
  notes: z.string().max(1000).optional(),
})

/**
 * Record a prorated additional-outlet payment.
 *
 * The `packageKey` selects what the new outlet covers:
 *   - 'komplit' → uses POS Komplit additional rate (bundled all-in
 *     POS + Inventory + Attendance). Creates ONE charged POS row +
 *     ONE Rp 0 Inventory row so both modules' billed counts stay
 *     in sync (drift card and tenant hard-block read per-module).
 *   - 'pos-only' → POS-only à la carte. Bumps POS billed only.
 *   - 'inventory-only' → Inventory-only à la carte (gudang case).
 *     Bumps Inventory billed only.
 *
 * Amount = ratePerMonth × monthsRemaining × additionalCount where
 * the period spans `now → existing subscription's periodEndAt` (a
 * partial window — no subscription extension). The subscription's
 * tier / expires_at on settings tables stays untouched.
 */
export const recordAdditionalOutletPayment = createServerFn({
  method: 'POST',
})
  .inputValidator(recordAdditionalOutletSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    // Read both module's latest paid transactions — we need POS for
    // komplit + pos-only routes, Inventory for inventory-only +
    // komplit's paired Rp 0 record.
    const [posLast] = await db
      .select({
        planKey: financialTransactions.planKey,
        billedOutletCount: financialTransactions.billedOutletCount,
        periodEndAt: financialTransactions.periodEndAt,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.tenantId, data.tenantId),
          eq(financialTransactions.moduleKey, 'pos'),
          eq(financialTransactions.status, 'paid'),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt))
      .limit(1)

    const [invLast] = await db
      .select({
        planKey: financialTransactions.planKey,
        billedOutletCount: financialTransactions.billedOutletCount,
        periodEndAt: financialTransactions.periodEndAt,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.tenantId, data.tenantId),
          eq(financialTransactions.moduleKey, 'inventory'),
          eq(financialTransactions.status, 'paid'),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt))
      .limit(1)

    const now = new Date()

    function monthsLeft(periodEndAt: Date | null | undefined): number {
      if (!periodEndAt) return 0
      const ms = Math.max(0, new Date(periodEndAt).getTime() - now.getTime())
      if (ms === 0) return 0
      return Math.max(1, Math.ceil(ms / (30 * 24 * 60 * 60 * 1000)))
    }

    // Resolve the charge route based on packageKey.
    type ChargeRoute = {
      primaryModule: 'pos' | 'inventory'
      primaryPlanKey: string
      primaryPeriodEnd: Date
      primaryBilledFrom: number
      ratePerMonth: number
      pairInventoryRow: boolean // true for komplit — adds a Rp 0 mirror
    }
    let route: ChargeRoute
    if (data.packageKey === 'komplit') {
      if (!posLast)
        throw new Error('Tenant belum punya paket POS aktif.')
      const posPlan = findPOSPlan(posLast.planKey)
      if (!posPlan || posPlan.tier !== 'komplit') {
        throw new Error(
          'Paket Komplit hanya bisa dipakai oleh tenant yang sudah aktif di Komplit.',
        )
      }
      route = {
        primaryModule: 'pos',
        primaryPlanKey: posLast.planKey,
        primaryPeriodEnd: new Date(posLast.periodEndAt),
        primaryBilledFrom: posLast.billedOutletCount ?? 1,
        ratePerMonth: posPlan.additionalOutletPerMonth,
        pairInventoryRow: true,
      }
    } else if (data.packageKey === 'pos-only') {
      if (!posLast)
        throw new Error('Tenant belum punya paket POS aktif.')
      const posPlan = findPOSPlan(posLast.planKey)
      if (!posPlan)
        throw new Error(`Paket ${posLast.planKey} tidak ditemukan`)
      // For Komplit tenants doing POS-only, charge POS Toko rates.
      const ratesPlan =
        posPlan.tier === 'komplit'
          ? POS_PLANS.find(
              (p) =>
                p.tier === 'toko' &&
                p.durationMonths === posPlan.durationMonths,
            )
          : posPlan
      if (!ratesPlan)
        throw new Error('Tarif POS Toko tidak ditemukan')
      route = {
        primaryModule: 'pos',
        primaryPlanKey: ratesPlan.key,
        primaryPeriodEnd: new Date(posLast.periodEndAt),
        primaryBilledFrom: posLast.billedOutletCount ?? 1,
        ratePerMonth: ratesPlan.additionalOutletPerMonth,
        pairInventoryRow: false,
      }
    } else {
      if (!invLast)
        throw new Error('Tenant belum punya paket Inventory aktif.')
      const invPlan = findInventoryPlan(invLast.planKey)
      if (!invPlan)
        throw new Error(`Paket ${invLast.planKey} tidak ditemukan`)
      route = {
        primaryModule: 'inventory',
        primaryPlanKey: invLast.planKey,
        primaryPeriodEnd: new Date(invLast.periodEndAt),
        primaryBilledFrom: invLast.billedOutletCount ?? 1,
        ratePerMonth: invPlan.additionalLocationPerMonth,
        pairInventoryRow: false,
      }
    }

    if (route.ratePerMonth <= 0) {
      throw new Error(
        'Paket ini tidak punya biaya tambahan outlet — periksa konfigurasi paket.',
      )
    }
    if (route.primaryPeriodEnd.getTime() <= now.getTime()) {
      throw new Error(
        'Paket sudah expired. Perpanjang dulu sebelum menambah outlet.',
      )
    }
    const monthsRemaining = monthsLeft(route.primaryPeriodEnd)
    const amountIdr =
      route.ratePerMonth * monthsRemaining * data.additionalOutletCount
    const newBilledCount =
      route.primaryBilledFrom + data.additionalOutletCount

    const proofKey = data.proofDataUrl
      ? await (async () => {
          const parsed = parseDataUrl(data.proofDataUrl!)
          if (!parsed) throw new Error('Bukti transfer tidak valid')
          const tempKey = crypto.randomUUID()
          const { key } = await uploadFinancialProof({
            tenantId: data.tenantId,
            invoiceNumber: tempKey,
            bytes: parsed.bytes,
            mimeType: parsed.mimeType,
          })
          return key
        })()
      : null

    return db.transaction(async (tx) => {
      async function nextInvoice(): Promise<string> {
        const year = now.getUTCFullYear()
        const [counter] = await tx
          .insert(financialInvoiceCounters)
          .values({ year, lastNumber: 1 })
          .onConflictDoUpdate({
            target: financialInvoiceCounters.year,
            set: {
              lastNumber: sql`${financialInvoiceCounters.lastNumber} + 1`,
              updatedAt: new Date(),
            },
          })
          .returning({ n: financialInvoiceCounters.lastNumber })
        return `INV-${year}-${String(counter!.n).padStart(4, '0')}`
      }

      const primaryInvoice = await nextInvoice()
      const [primary] = await tx
        .insert(financialTransactions)
        .values({
          tenantId: data.tenantId,
          invoiceNumber: primaryInvoice,
          moduleKey: route.primaryModule,
          planKey: route.primaryPlanKey,
          periodStartAt: now,
          periodEndAt: route.primaryPeriodEnd,
          amountIdr: amountIdr.toString(),
          transferDate: data.transferDate,
          bankReference: data.bankReference ?? null,
          proofPhotoKey: proofKey,
          billedStaffCount: 0,
          billedOutletCount: newBilledCount,
          notes:
            data.notes ??
            `Penambahan ${data.additionalOutletCount} outlet (${data.packageKey}, pro-rata ${monthsRemaining} bulan)`,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
        .returning()

      // Komplit bundle: mirror the new billed count on the Inventory
      // module so its drift card / tenant hard-block reads the same
      // capacity. Amount = 0 since the bundle already paid for it via
      // the primary POS row.
      let mirrorInvoice: string | null = null
      let mirrorNewBilled = invLast?.billedOutletCount ?? 0
      if (route.pairInventoryRow && invLast) {
        mirrorNewBilled =
          (invLast.billedOutletCount ?? 1) + data.additionalOutletCount
        mirrorInvoice = await nextInvoice()
        await tx.insert(financialTransactions).values({
          tenantId: data.tenantId,
          invoiceNumber: mirrorInvoice,
          moduleKey: 'inventory',
          planKey: invLast.planKey,
          periodStartAt: now,
          periodEndAt: new Date(invLast.periodEndAt),
          amountIdr: '0',
          transferDate: data.transferDate,
          bankReference: data.bankReference ?? null,
          proofPhotoKey: null,
          billedStaffCount: 0,
          billedOutletCount: mirrorNewBilled,
          notes: `Bundled in Komplit (${primaryInvoice})`,
          status: 'paid',
          recordedByUserId: auth.userId,
        })
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: `add_outlet_${data.packageKey}`,
        targetTenantId: data.tenantId,
      })

      return {
        success: true as const,
        invoiceNumber: primaryInvoice,
        mirrorInvoiceNumber: mirrorInvoice,
        amountIdr,
        newBilledOutletCount: newBilledCount,
        mirrorBilledOutletCount: route.pairInventoryRow
          ? mirrorNewBilled
          : null,
        transactionId: primary!.id,
      }
    })
  })
