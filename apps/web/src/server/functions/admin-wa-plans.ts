import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { waSubscriptionPlans } from '@vintra/db/schema'
import { eq, asc } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type WaPlan = typeof waSubscriptionPlans.$inferSelect

export const listWaPlans = createServerFn({ method: 'POST' }).handler(async () => {
  await requirePlatformAdmin()
  return db.select().from(waSubscriptionPlans).orderBy(asc(waSubscriptionPlans.priceIdr))
})

const updateSchema = z.object({
  planKey: z.string(),
  displayName: z.string().min(1),
  priceIdr: z.number().int().positive(),
  maxInstances: z.number().int().positive(),
  maxMonthlyReplies: z.number().int().positive(),
  ragScope: z.enum(['stock', 'full']),
  isActive: z.boolean(),
})

export const updateWaPlan = createServerFn({ method: 'POST' })
  .inputValidator(updateSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .update(waSubscriptionPlans)
      .set({
        displayName: data.displayName,
        priceIdr: String(data.priceIdr),
        maxInstances: data.maxInstances,
        maxMonthlyReplies: data.maxMonthlyReplies,
        ragScope: data.ragScope,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(eq(waSubscriptionPlans.planKey, data.planKey))
      .returning()
    return row
  })
