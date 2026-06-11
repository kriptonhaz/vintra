import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { referralGlobalConfig, platformAdminAuditLogs } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'
import { requirePlatformAdmin } from '@/server/middleware/platform-admin'

export const getReferralConfig = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePlatformAdmin()
  const [row] = await db.select().from(referralGlobalConfig).limit(1)
  return row ?? null
})

const updateSchema = z.object({
  capPct: z.string().regex(/^\d+(\.\d{1,2})?$/),
  defaultWindowMonths: z.number().int().min(1).max(60),
  clawbackDays: z.number().int().min(1).max(365),
})

export const updateReferralConfig = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()
    const [before] = await db.select().from(referralGlobalConfig).limit(1)
    if (!before) throw new Error('referral_global_config row missing')

    await db
      .update(referralGlobalConfig)
      .set({
        capPct: data.capPct,
        defaultWindowMonths: data.defaultWindowMonths,
        clawbackDays: data.clawbackDays,
        updatedAt: new Date(),
        updatedBy: auth.userId,
      })
      .where(eq(referralGlobalConfig.id, before.id))

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'referral_config_update',
      targetTenantId: null,
      targetUserId: null,
      metadata: { before, after: data },
    })
  })
