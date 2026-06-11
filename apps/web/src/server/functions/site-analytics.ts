/**
 * JUR-176 follow-up: public-site analytics dashboard server fns.
 *
 * Only the auth-gated dashboard read lives here. View recording is
 * called from `getIndexRouteHostData` + `getPublicQueueData` — those
 * import the recorder directly from `server/lib/record-site-view.ts`
 * so this file doesn't pull in `db` at module load (which would leak
 * into the client bundle since the analytics page route imports
 * the read server fn).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { tenantSiteViews } from '@vintra/db/schema'
import { and, eq, gte, sql, desc } from 'drizzle-orm'
import { requirePermission } from '../middleware/auth'
import { requireTenantSiteAccess } from '../middleware/module-access'

const summarySchema = z.object({
  rangeDays: z.number().int().min(1).max(365).default(30),
})

export const getSiteAnalyticsSummary = createServerFn({ method: 'POST' })
  .inputValidator(summarySchema)
  .handler(async ({ data }) => {
    // Komplit-only — same gate as the editor itself.
    await requireTenantSiteAccess()
    const { tenantId } = await requirePermission('booking.write')

    const rangeStart = new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [totals, todayCount, daily, topReferrers] = await Promise.all([
      db
        .select({
          total: sql<number>`COUNT(*)::int`,
          unique: sql<number>`COUNT(DISTINCT ${tenantSiteViews.visitorHash})::int`,
        })
        .from(tenantSiteViews)
        .where(
          and(
            eq(tenantSiteViews.tenantId, tenantId),
            gte(tenantSiteViews.viewedAt, rangeStart),
          ),
        ),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tenantSiteViews)
        .where(
          and(
            eq(tenantSiteViews.tenantId, tenantId),
            gte(tenantSiteViews.viewedAt, todayStart),
          ),
        ),

      // Bucketed by Jakarta date so the chart aligns with the
      // tenant's calendar.
      db
        .select({
          day: sql<string>`(${tenantSiteViews.viewedAt} AT TIME ZONE 'Asia/Jakarta')::date::text`,
          total: sql<number>`COUNT(*)::int`,
          unique: sql<number>`COUNT(DISTINCT ${tenantSiteViews.visitorHash})::int`,
        })
        .from(tenantSiteViews)
        .where(
          and(
            eq(tenantSiteViews.tenantId, tenantId),
            gte(tenantSiteViews.viewedAt, rangeStart),
          ),
        )
        .groupBy(
          sql`(${tenantSiteViews.viewedAt} AT TIME ZONE 'Asia/Jakarta')::date`,
        )
        .orderBy(
          sql`(${tenantSiteViews.viewedAt} AT TIME ZONE 'Asia/Jakarta')::date`,
        ),

      db
        .select({
          referrer: tenantSiteViews.referrer,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(tenantSiteViews)
        .where(
          and(
            eq(tenantSiteViews.tenantId, tenantId),
            gte(tenantSiteViews.viewedAt, rangeStart),
            sql`${tenantSiteViews.referrer} IS NOT NULL`,
          ),
        )
        .groupBy(tenantSiteViews.referrer)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10),
    ])

    return {
      rangeDays: data.rangeDays,
      totalVisits: totals[0]?.total ?? 0,
      uniqueVisitors: totals[0]?.unique ?? 0,
      todayVisits: todayCount[0]?.count ?? 0,
      daily,
      topReferrers,
    }
  })
