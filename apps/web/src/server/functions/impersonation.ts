import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  activeImpersonations,
  platformAdminAuditLogs,
  tenants,
} from '@vintra/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getOptionalAuth } from '../middleware/auth'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export const startImpersonation = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [tenant] = await db
      .select({ id: tenants.id, businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan')

    // Upsert: any existing impersonation for this admin is replaced
    await db
      .insert(activeImpersonations)
      .values({ adminUserId: auth.userId, tenantId: tenant.id })
      .onConflictDoUpdate({
        target: activeImpersonations.adminUserId,
        set: { tenantId: tenant.id, startedAt: new Date() },
      })

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'impersonate_start',
      targetTenantId: tenant.id,
      metadata: { tenantName: tenant.businessName },
    })

    return { tenantId: tenant.id, businessName: tenant.businessName }
  })

export const endImpersonation = createServerFn({ method: 'POST' }).handler(
  async () => {
    // Only platform admins can have an active impersonation, but check loosely
    // in case access was revoked while impersonating.
    const auth = await getOptionalAuth()
    if (!auth) throw new Error('Unauthorized')

    const [active] = await db
      .select()
      .from(activeImpersonations)
      .where(eq(activeImpersonations.adminUserId, auth.userId))
      .limit(1)

    if (!active) return { ended: false }

    await db
      .delete(activeImpersonations)
      .where(eq(activeImpersonations.adminUserId, auth.userId))

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'impersonate_end',
      targetTenantId: active.tenantId,
    })

    return { ended: true }
  },
)

export const getImpersonationState = createServerFn().handler(async () => {
  const auth = await getOptionalAuth()
  if (!auth) return { impersonating: false as const }

  const [active] = await db
    .select({
      tenantId: activeImpersonations.tenantId,
      startedAt: activeImpersonations.startedAt,
      businessName: tenants.businessName,
    })
    .from(activeImpersonations)
    .innerJoin(tenants, eq(activeImpersonations.tenantId, tenants.id))
    .where(eq(activeImpersonations.adminUserId, auth.userId))
    .limit(1)

  if (!active) return { impersonating: false as const }
  return {
    impersonating: true as const,
    tenantId: active.tenantId,
    businessName: active.businessName,
    startedAt: active.startedAt,
  }
})
