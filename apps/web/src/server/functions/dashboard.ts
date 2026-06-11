import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import { products, materials, overheadCosts } from '@vintra/db/schema'
import { eq, sql, avg, min } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'

export const getDashboardStats = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()

  const [productStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      avgMargin: avg(products.margin),
      minMargin: min(products.margin),
    })
    .from(products)
    .where(eq(products.tenantId, tenantId))

  const [materialStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(materials)
    .where(eq(materials.tenantId, tenantId))

  const [overheadStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(amount), 0)`,
    })
    .from(overheadCosts)
    .where(eq(overheadCosts.tenantId, tenantId))

  return {
    products: {
      count: productStats?.count ?? 0,
      avgMargin: productStats?.avgMargin ? Number(productStats.avgMargin) : null,
      minMargin: productStats?.minMargin ? Number(productStats.minMargin) : null,
    },
    materials: {
      count: materialStats?.count ?? 0,
    },
    overheads: {
      count: overheadStats?.count ?? 0,
      totalMonthly: Number(overheadStats?.total ?? 0),
    },
  }
})
