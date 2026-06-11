import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import { tenants } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'

export const getCurrentTenant = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()

  const tenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  if (tenant.length === 0) {
    throw new Error('Tenant tidak ditemukan')
  }

  return tenant[0]!
})
