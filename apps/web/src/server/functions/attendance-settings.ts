import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  attendanceSettings,
  staffProfiles,
  branches,
  attendanceRecords,
  financialTransactions,
  tenantMembers,
} from '@vintra/db/schema'
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm'
import { findAnyPlan } from '@vintra/shared'
import { getFinancialProofSignedUrl } from '@/lib/s3-storage'
import { z } from 'zod'
import { requirePermission } from '../middleware/auth'
import { assertBranchAllowed } from '../lib/branch-scope'
import { requireActiveModule } from '../middleware/module-access'
import { dateKeyJakarta } from '@/lib/jakarta-time'

const MODULE_KEY = 'attendance'

/**
 * Loads the current tenant's attendance settings + some rollup counts
 * used by the dashboard and settings pages. The settings row is created
 * lazily the first time the tenant accesses the module (with defaults).
 */
export const getAttendanceOverview = createServerFn().handler(async () => {
  const auth = await requireActiveModule(MODULE_KEY)

  let [settings] = await db
    .select()
    .from(attendanceSettings)
    .where(eq(attendanceSettings.tenantId, auth.tenantId))
    .limit(1)

  if (!settings) {
    const [created] = await db
      .insert(attendanceSettings)
      .values({ tenantId: auth.tenantId, subscriptionActive: true })
      .returning()
    settings = created!
  }

  const [staffCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${staffProfiles.isActive} = true)::int`,
    })
    .from(staffProfiles)
    .where(eq(staffProfiles.tenantId, auth.tenantId))

  const [branchCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${branches.isActive} = true)::int`,
    })
    .from(branches)
    .where(eq(branches.tenantId, auth.tenantId))

  // Derive the current plan from the most recent paid, non-refunded
  // transaction for this tenant. "Current plan" isn't a stored column
  // because a tenant can stack multiple periods — the last paid one
  // reflects what was last agreed on.
  const ft = financialTransactions
  const [currentTx] = await db
    .select({
      planKey: ft.planKey,
      periodStartAt: ft.periodStartAt,
      periodEndAt: ft.periodEndAt,
      billedStaffCount: ft.billedStaffCount,
      amountIdr: ft.amountIdr,
      invoiceNumber: ft.invoiceNumber,
    })
    .from(ft)
    .where(
      and(
        eq(ft.tenantId, auth.tenantId),
        eq(ft.moduleKey, MODULE_KEY),
        eq(ft.status, 'paid'),
        // Exclude paid rows that already have a refund linked to them —
        // using raw SQL for the correlated sub-SELECT (the table alias
        // dance in drizzle for same-table `notExists` isn't worth the
        // complexity for one query).
        sql`NOT EXISTS (
          SELECT 1 FROM financial_transactions r
          WHERE r.refund_of_transaction_id = ${ft.id}
            AND r.status = 'refund'
        )`,
      ),
    )
    .orderBy(desc(ft.createdAt))
    .limit(1)

  const plan = currentTx ? findAnyPlan(currentTx.planKey) : null
  // For display, treat the row's period_end_at as the window boundary —
  // EXCEPT for trials, where trial_ends_at on attendance_settings is the
  // live value (admin can extend it mid-trial).
  const isTrial = plan?.key === 'attendance_trial'
  const currentPlan = plan
    ? {
        planKey: plan.key,
        labelKey: plan.labelKey,
        durationMonths: plan.durationMonths,
        pricePerStaffPerMonth: plan.pricePerStaffPerMonth,
        billedStaffCount: currentTx!.billedStaffCount,
        amountIdr: Number(currentTx!.amountIdr),
        invoiceNumber: currentTx!.invoiceNumber,
        periodStartAt: currentTx!.periodStartAt,
        periodEndAt:
          isTrial && settings.trialEndsAt
            ? settings.trialEndsAt
            : currentTx!.periodEndAt,
        isTrial,
      }
    : null

  return {
    settings,
    staff: staffCounts ?? { total: 0, active: 0 },
    branches: branchCounts ?? { total: 0, active: 0 },
    currentPlan,
  }
})

// ─── Tenant-facing billing history ──────────────────
// Mirrors the admin finance reads but is scoped to the caller's own
// tenant and redacts admin-only fields (recordedByUserId). Owner/admin
// of a tenant sees their own payment log; staff never reach this code
// because the route is permission-gated on attendance.manage.

export const getMyBillingHistory = createServerFn().handler(async () => {
  const auth = await requireActiveModule(MODULE_KEY)
  await requirePermission('attendance.manage')

  const rows = await db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.tenantId, auth.tenantId))
    .orderBy(desc(financialTransactions.createdAt))

  const refundedOriginalIds = new Set(
    rows
      .filter((r) => r.status === 'refund' && r.refundOfTransactionId)
      .map((r) => r.refundOfTransactionId!),
  )

  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    moduleKey: r.moduleKey,
    planKey: r.planKey,
    amountIdr: Number(r.amountIdr),
    transferDate: r.transferDate,
    periodStartAt: r.periodStartAt,
    periodEndAt: r.periodEndAt,
    billedStaffCount: r.billedStaffCount,
    status: r.status,
    refundOfTransactionId: r.refundOfTransactionId,
    notes: r.notes,
    bankReference: r.bankReference,
    createdAt: r.createdAt,
    hasRefund: refundedOriginalIds.has(r.id),
  }))
})

export const getMyTransaction = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    const [row] = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.id, data.id),
          eq(financialTransactions.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Transaksi tidak ditemukan')

    const proofUrl = row.proofPhotoKey
      ? await getFinancialProofSignedUrl(row.proofPhotoKey).catch(() => null)
      : null

    // Same paired linkage as the admin detail drawer, but without
    // exposing recordedByUserId / email.
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
      proofUrl,
      originalTransaction: originalTransaction
        ? { ...originalTransaction, amountIdr: Number(originalTransaction.amountIdr) }
        : null,
      refundTransaction: refundTransaction
        ? { ...refundTransaction, amountIdr: Number(refundTransaction.amountIdr) }
        : null,
    }
  })

const modeTogglesSchema = z
  .object({
    gps: z.boolean(),
    photo: z.boolean(),
    qr: z.boolean(),
  })
  .refine((d) => d.gps || d.photo || d.qr, {
    message: 'Minimal satu metode verifikasi harus aktif.',
  })

export const updateModeToggles = createServerFn({ method: 'POST' })
  .inputValidator(modeTogglesSchema)
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    await db
      .insert(attendanceSettings)
      .values({
        tenantId: auth.tenantId,
        modeGpsEnabled: data.gps,
        modePhotoEnabled: data.photo,
        modeQrEnabled: data.qr,
      })
      .onConflictDoUpdate({
        target: attendanceSettings.tenantId,
        set: {
          modeGpsEnabled: data.gps,
          modePhotoEnabled: data.photo,
          modeQrEnabled: data.qr,
          updatedAt: new Date(),
        },
      })

    return { success: true }
  })

export const updateQrRotation = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ seconds: z.number().int().min(15).max(120) }))
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    await db
      .update(attendanceSettings)
      .set({ qrRotationSeconds: data.seconds, updatedAt: new Date() })
      .where(eq(attendanceSettings.tenantId, auth.tenantId))

    return { success: true }
  })

export const updateAttendanceReminderSettings = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      clockinReminderEnabled: z.boolean(),
      clockinReminderMinutes: z.number().int().min(1).max(120),
      clockinReminderDirection: z.enum(['before', 'after']),
      clockoutReminderEnabled: z.boolean(),
      clockoutReminderMinutes: z.number().int().min(1).max(120),
      clockoutReminderDirection: z.enum(['before', 'after']),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireActiveModule(MODULE_KEY)
    await requirePermission('attendance.manage')

    await db
      .update(attendanceSettings)
      .set({
        clockinReminderEnabled: data.clockinReminderEnabled,
        clockinReminderMinutes: data.clockinReminderMinutes,
        clockinReminderDirection: data.clockinReminderDirection,
        clockoutReminderEnabled: data.clockoutReminderEnabled,
        clockoutReminderMinutes: data.clockoutReminderMinutes,
        clockoutReminderDirection: data.clockoutReminderDirection,
        updatedAt: new Date(),
      })
      .where(eq(attendanceSettings.tenantId, auth.tenantId))

    return { success: true }
  })

// ─── Dashboard stats ───────────────────────────────

/**
 * Aggregated stats for the attendance dashboard: today's on-time/late/absent
 * breakdown, the last 7 days' attendance history, and this month's top-late
 * staff list.
 */
export const getAttendanceDashboardStats = createServerFn()
  .inputValidator(
    z.object({ branchId: z.string().uuid().optional() }).optional(),
  )
  .handler(async ({ data }) => {
  const auth = await requireActiveModule(MODULE_KEY)
  await requirePermission(['attendance.manage', 'attendance.report'])

  // Optional branch scope (topbar branch switcher). No branchId ⇒ the
  // legacy tenant-wide aggregate across every branch.
  const branchId = data?.branchId
  if (branchId) assertBranchAllowed(auth, branchId)

  const today = dateKeyJakarta()
  const sevenDaysAgo = dateKeyJakarta(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000))
  const monthStart = today.slice(0, 8) + '01'

  // Active staff count (for absent derivation)
  const [staffCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.tenantId, auth.tenantId),
        eq(staffProfiles.isActive, true),
        branchId ? eq(staffProfiles.branchId, branchId) : undefined,
      ),
    )
  const totalActiveStaff = staffCount?.count ?? 0

  // Whether the tenant has any schedule-backed ("advanced") branch.
  // When false, every branch runs in simple mode and the dashboard
  // shows plain presence counts instead of on-time/late scoring.
  const [schedBranch] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(branches)
    .where(
      and(
        eq(branches.tenantId, auth.tenantId),
        eq(branches.requiresSchedule, true),
        branchId ? eq(branches.id, branchId) : undefined,
      ),
    )
  const hasScheduledBranch = (schedBranch?.count ?? 0) > 0

  // Today's counts. `presentCount` counts every record with a clock-in
  // regardless of status — so simple-mode 'present' rows are included
  // (the on_time + late sum would miss them).
  const [todayStats] = await db
    .select({
      onTime: sql<number>`count(*) filter (where ${attendanceRecords.clockInStatus} = 'on_time')::int`,
      late: sql<number>`count(*) filter (where ${attendanceRecords.clockInStatus} = 'late')::int`,
      present: sql<number>`count(*) filter (where ${attendanceRecords.clockInStatus} = 'present')::int`,
      presentCount: sql<number>`count(*) filter (where ${attendanceRecords.clockInAt} is not null)::int`,
      clockedOut: sql<number>`count(*) filter (where ${attendanceRecords.clockOutAt} is not null)::int`,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.tenantId, auth.tenantId),
        eq(attendanceRecords.date, today),
        branchId ? eq(attendanceRecords.branchId, branchId) : undefined,
      ),
    )

  const presentToday = todayStats?.presentCount ?? 0
  const absentToday = Math.max(0, totalActiveStaff - presentToday)

  // Last 7 days breakdown (including today)
  const sevenDayRows = await db
    .select({
      date: attendanceRecords.date,
      onTime: sql<number>`count(*) filter (where ${attendanceRecords.clockInStatus} = 'on_time')::int`,
      late: sql<number>`count(*) filter (where ${attendanceRecords.clockInStatus} = 'late')::int`,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.tenantId, auth.tenantId),
        gte(attendanceRecords.date, sevenDaysAgo),
        lte(attendanceRecords.date, today),
        branchId ? eq(attendanceRecords.branchId, branchId) : undefined,
      ),
    )
    .groupBy(attendanceRecords.date)
    .orderBy(attendanceRecords.date)

  // Fill in missing days so the chart always shows 7 bars
  const sevenDays: Array<{ date: string; onTime: number; late: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = dateKeyJakarta(new Date(Date.now() - i * 24 * 60 * 60 * 1000))
    const row = sevenDayRows.find((r) => r.date === d)
    sevenDays.push({
      date: d,
      onTime: row?.onTime ?? 0,
      late: row?.late ?? 0,
    })
  }

  // Top 5 late staff this month. Name derived from tenant_members
  // (legacy staff_profiles.full_name dropped in migration 0035).
  const staffNameExpr = sql<string>`TRIM(COALESCE(${tenantMembers.firstName}, '') || ' ' || COALESCE(${tenantMembers.lastName}, ''))`
  const topLate = await db
    .select({
      staffId: staffProfiles.id,
      staffName: staffNameExpr,
      lateCount: sql<number>`count(*)::int`,
    })
    .from(attendanceRecords)
    .innerJoin(
      staffProfiles,
      eq(attendanceRecords.staffProfileId, staffProfiles.id),
    )
    .innerJoin(tenantMembers, eq(staffProfiles.tenantMemberId, tenantMembers.id))
    .where(
      and(
        eq(attendanceRecords.tenantId, auth.tenantId),
        gte(attendanceRecords.date, monthStart),
        lte(attendanceRecords.date, today),
        eq(attendanceRecords.clockInStatus, 'late'),
        branchId ? eq(attendanceRecords.branchId, branchId) : undefined,
      ),
    )
    .groupBy(staffProfiles.id, tenantMembers.firstName, tenantMembers.lastName)
    .orderBy(desc(sql`count(*)`))
    .limit(5)

  return {
    hasScheduledBranch,
    today: {
      totalActiveStaff,
      onTime: todayStats?.onTime ?? 0,
      late: todayStats?.late ?? 0,
      present: todayStats?.present ?? 0,
      presentToday,
      absent: absentToday,
      clockedOut: todayStats?.clockedOut ?? 0,
    },
    sevenDays,
    topLateThisMonth: topLate,
  }
})
