import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  tenants,
  posSettings,
  platformAdminAuditLogs,
  financialTransactions,
} from '@vintra/db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { findPOSPlan } from '@vintra/shared'
import { requirePlatformAdmin } from '../middleware/platform-admin'

const MODULE_KEY = 'pos'

/**
 * Admin read endpoint mirroring `getInventorySubscription`. Returns
 * the tenant's POS settings + most-recent paid transaction so the
 * admin tenant page can render the active plan, period end, and
 * activate/renew buttons.
 */
export const getPOSSubscription = createServerFn()
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
      .from(posSettings)
      .where(eq(posSettings.tenantId, data.tenantId))
      .limit(1)

    const ft = financialTransactions
    const [currentTx] = await db
      .select({
        planKey: ft.planKey,
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

    const plan = currentTx ? findPOSPlan(currentTx.planKey) : null
    const currentPlan = plan
      ? {
          planKey: plan.key,
          labelKey: plan.labelKey,
          tier: plan.tier,
          durationMonths: plan.durationMonths,
          pricePerMonth: plan.pricePerMonth,
          amountIdr: Number(currentTx!.amountIdr),
          invoiceNumber: currentTx!.invoiceNumber,
          periodStartAt: currentTx!.periodStartAt,
          periodEndAt: currentTx!.periodEndAt,
          transferDate: currentTx!.transferDate,
        }
      : null

    return {
      tenant,
      settings: settings ?? null,
      currentPlan,
    }
  })

export const deactivatePOS = createServerFn({ method: 'POST' })
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
      .update(posSettings)
      .set({ subscriptionActive: false, updatedAt: new Date() })
      .where(eq(posSettings.tenantId, data.tenantId))

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'pos_deactivate',
      targetTenantId: data.tenantId,
    })

    return { success: true }
  })
