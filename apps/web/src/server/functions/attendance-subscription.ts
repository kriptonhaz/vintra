import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  tenants,
  attendanceSettings,
  platformAdminAuditLogs,
  financialTransactions,
} from '@vintra/db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { findAnyPlan } from '@vintra/shared'
import { requirePlatformAdmin } from '../middleware/platform-admin'

const MODULE_KEY = 'attendance'

export const getAttendanceSubscription = createServerFn()
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [tenant] = await db
      .select({ id: tenants.id, activeModules: tenants.activeModules })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const [settings] = await db
      .select()
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, data.tenantId))
      .limit(1)

    // Derive "current plan" from the latest paid non-refunded transaction.
    // Tenants activated before the finance feature have no tx row → plan is null.
    const ft = financialTransactions
    const [currentTx] = await db
      .select({
        planKey: ft.planKey,
        billedStaffCount: ft.billedStaffCount,
        amountIdr: ft.amountIdr,
        invoiceNumber: ft.invoiceNumber,
        periodStartAt: ft.periodStartAt,
        periodEndAt: ft.periodEndAt,
        transferDate: ft.transferDate,
      })
      .from(ft)
      .where(
        and(
          eq(ft.tenantId, data.tenantId),
          eq(ft.moduleKey, MODULE_KEY),
          eq(ft.status, 'paid'),
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
          // For trials, read live trial_ends_at (admin can extend).
          periodEndAt:
            isTrial && settings?.trialEndsAt
              ? settings.trialEndsAt
              : currentTx!.periodEndAt,
          transferDate: currentTx!.transferDate,
          isTrial,
        }
      : null

    return {
      tenantId: tenant.id,
      moduleActive: tenant.activeModules.includes(MODULE_KEY),
      settings: settings ?? null,
      currentPlan,
    }
  })

export const activateAttendance = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      expiresAt: z.string().datetime(),
      billedStaffCount: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select({ activeModules: tenants.activeModules })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const newModules = tenant.activeModules.includes(MODULE_KEY)
      ? tenant.activeModules
      : [...tenant.activeModules, MODULE_KEY]

    await db
      .update(tenants)
      .set({ activeModules: newModules, updatedAt: new Date() })
      .where(eq(tenants.id, data.tenantId))

    const startedAt = new Date()
    const expiresAt = new Date(data.expiresAt)

    await db
      .insert(attendanceSettings)
      .values({
        tenantId: data.tenantId,
        subscriptionActive: true,
        subscriptionStartedAt: startedAt,
        subscriptionExpiresAt: expiresAt,
        billedStaffCount: data.billedStaffCount,
      })
      .onConflictDoUpdate({
        target: attendanceSettings.tenantId,
        set: {
          subscriptionActive: true,
          subscriptionStartedAt: startedAt,
          subscriptionExpiresAt: expiresAt,
          billedStaffCount: data.billedStaffCount,
          updatedAt: new Date(),
        },
      })

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'attendance_activate',
      targetTenantId: data.tenantId,
      metadata: {
        expiresAt: data.expiresAt,
        billedStaffCount: data.billedStaffCount,
      },
    })

    return { success: true }
  })

export const updateAttendanceSubscription = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      expiresAt: z.string().datetime(),
      billedStaffCount: z.number().int().min(0),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select({ activeModules: tenants.activeModules })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')
    if (!tenant.activeModules.includes(MODULE_KEY)) {
      throw new Error(
        'Modul Absensi tidak aktif untuk tenant ini. Aktifkan terlebih dahulu sebelum mengubah periode atau jumlah staf.',
      )
    }

    const expiresAt = new Date(data.expiresAt)

    const [updated] = await db
      .update(attendanceSettings)
      .set({
        subscriptionExpiresAt: expiresAt,
        billedStaffCount: data.billedStaffCount,
        updatedAt: new Date(),
      })
      .where(eq(attendanceSettings.tenantId, data.tenantId))
      .returning()
    if (!updated) throw new Error('Pengaturan absensi tidak ditemukan')

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'attendance_update',
      targetTenantId: data.tenantId,
      metadata: {
        expiresAt: data.expiresAt,
        billedStaffCount: data.billedStaffCount,
      },
    })

    return { success: true }
  })

export const deactivateAttendance = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select({ activeModules: tenants.activeModules })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    const newModules = tenant.activeModules.filter((m) => m !== MODULE_KEY)

    await db
      .update(tenants)
      .set({ activeModules: newModules, updatedAt: new Date() })
      .where(eq(tenants.id, data.tenantId))

    await db
      .update(attendanceSettings)
      .set({ subscriptionActive: false, updatedAt: new Date() })
      .where(eq(attendanceSettings.tenantId, data.tenantId))

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'attendance_deactivate',
      targetTenantId: data.tenantId,
    })

    return { success: true }
  })

export const listAttendanceSubscriptions = createServerFn().handler(
  async () => {
    await requirePlatformAdmin()

    const rows = await db
      .select({
        tenantId: attendanceSettings.tenantId,
        subscriptionActive: attendanceSettings.subscriptionActive,
        subscriptionStartedAt: attendanceSettings.subscriptionStartedAt,
        subscriptionExpiresAt: attendanceSettings.subscriptionExpiresAt,
        billedStaffCount: attendanceSettings.billedStaffCount,
        tenantName: tenants.businessName,
      })
      .from(attendanceSettings)
      .innerJoin(tenants, eq(attendanceSettings.tenantId, tenants.id))
      .orderBy(desc(attendanceSettings.subscriptionStartedAt))

    return rows
  },
)
