/**
 * Platform-admin dashboard stats (JUR-82).
 *
 * One server fn that returns a compact snapshot for the /admin landing
 * page — new tenants, new members, active modules, MRR estimate, active
 * WhatsApp instances, and the last 10 audit-log entries. Everything
 * fans out via Promise.all so the round-trip is bounded by the slowest
 * query, not the sum.
 */
import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  tenants,
  tenantMembers,
  posSettings,
  inventorySettings,
  attendanceSettings,
  waSettings,
  waInstances,
  waSubscriptionPlans,
  platformAdminAuditLogs,
} from '@vintra/db/schema'
import {
  POS_PLANS,
  INVENTORY_PLANS,
} from '@vintra/shared/constants/pricing'
import { and, count, desc, eq, gte, isNull, or, sql, sum } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

// MRR helper — finds the lowest pricePerMonth across all plans matching
// a tier. This is the annual rate by convention (annual plans are
// cheaper per month). Using the lowest gives a conservative MRR — if
// the tenant actually signed up monthly, real revenue is higher, never
// lower.
type PriceableTier = { tier: string; pricePerMonth: number }
function tierMrr(plans: readonly PriceableTier[], tier: string): number {
  const matching = plans.filter((p) => p.tier === tier && p.pricePerMonth > 0)
  if (matching.length === 0) return 0
  return matching.reduce(
    (min, p) => (p.pricePerMonth < min ? p.pricePerMonth : min),
    Infinity,
  )
}

// Active subscription predicate is inlined per query because Drizzle's
// column typings are nominal per table. Three shapes today:
//   - pos / inventory: tier != 'free' AND (expiry null OR > now)
//   - whatsapp:        same as above (has both `tier` and `subscriptionActive`)
//   - attendance:      subscriptionActive=true AND (expiry null OR > now)
//                      — no `tier` column; per-staff billing.
//
// Attendance MRR uses a conservative Rp/staff/month rate from the 12-mo
// plan; we count billed_staff_count rather than tenants.
const ATTENDANCE_PRICE_PER_STAFF_PER_MONTH = 5000

// Sparkline window — return per-day counts for the last 7 days so the
// dashboard can render a tiny trend without an extra round trip.
//
// Earlier this used `db.execute(sql\`...generate_series...\`)` with
// table interpolation. That tripped a "Failed query" wrap from the
// driver (sql tag interpolation of bare table objects is fragile).
// We do the bucketing in JS instead — pull the raw timestamps in the
// window via plain Drizzle and divide by day. At v1 scale (~tens of
// rows per week) the network bytes + JS work are negligible.
async function dailyCountsLast7Days(
  createdAts: Date[],
): Promise<number[]> {
  const buckets = [0, 0, 0, 0, 0, 0, 0]
  const dayMs = 24 * 60 * 60 * 1000
  // Anchor on midnight TODAY (local TZ on the server, which is the VPS
  // server-time = WIB in prod). Day 6 = today, Day 0 = 6 days ago.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()
  for (const ts of createdAts) {
    const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime()
    const ageDays = Math.floor((todayMs - t) / dayMs)
    // ageDays = 0 → today (bucket index 6); 6 → 6 days ago (bucket 0)
    const idx = 6 - ageDays
    if (idx >= 0 && idx < 7) buckets[idx] = (buckets[idx] ?? 0) + 1
  }
  return buckets
}

export interface AdminDashboardStats {
  newTenants: { last7: number; last30: number; spark: number[] }
  newMembers: { last7: number; last30: number; spark: number[] }
  modulesActive: {
    pos: number
    inventory: number
    attendance: number
    whatsapp: number
    total: number
  }
  /** MRR estimate. Uses the lowest pricePerMonth across plans matching
   * each tenant's tier (= the annual rate, conservative). Attendance
   * uses `billed_staff_count × conservative per-staff rate`. */
  mrrIdr: {
    total: number
    breakdown: {
      pos: number
      inventory: number
      attendance: number
      whatsapp: number
    }
  }
  activeWhatsappInstances: number
  recentActivity: Array<{
    id: string
    action: string
    adminUserId: string
    targetTenantId: string | null
    createdAt: string
    metadata: Record<string, {} | null> | null
  }>
}

export const getAdminDashboardStats = createServerFn({ method: 'POST' }).handler(
  async (): Promise<AdminDashboardStats> => {
    await requirePlatformAdmin()

    const now = new Date()
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Run everything in parallel — total wall time = slowest query.
    const [
      newTenants7,
      newTenants30,
      newTenantsRaw,
      newMembers7,
      newMembers30,
      newMembersRaw,
      posActiveRows,
      invActiveRows,
      attActiveAgg,
      waActiveRows,
      activeWaInstancesRow,
      recentAuditRows,
    ] = await Promise.all([
      db
        .select({ n: count() })
        .from(tenants)
        .where(gte(tenants.createdAt, d7)),
      db
        .select({ n: count() })
        .from(tenants)
        .where(gte(tenants.createdAt, d30)),
      // Raw timestamps in the 7-day window — bucketed below.
      db
        .select({ createdAt: tenants.createdAt })
        .from(tenants)
        .where(gte(tenants.createdAt, d7)),
      db
        .select({ n: count() })
        .from(tenantMembers)
        .where(gte(tenantMembers.createdAt, d7)),
      db
        .select({ n: count() })
        .from(tenantMembers)
        .where(gte(tenantMembers.createdAt, d30)),
      db
        .select({ createdAt: tenantMembers.createdAt })
        .from(tenantMembers)
        .where(gte(tenantMembers.createdAt, d7)),
      // POS: tier != 'free' AND not expired.
      db
        .select({ tier: posSettings.tier })
        .from(posSettings)
        .where(
          and(
            sql`${posSettings.tier} != 'free'`,
            or(
              isNull(posSettings.subscriptionExpiresAt),
              gte(posSettings.subscriptionExpiresAt, now),
            ),
          ),
        ),
      // Inventory: same shape as POS.
      db
        .select({ tier: inventorySettings.tier })
        .from(inventorySettings)
        .where(
          and(
            sql`${inventorySettings.tier} != 'free'`,
            or(
              isNull(inventorySettings.subscriptionExpiresAt),
              gte(inventorySettings.subscriptionExpiresAt, now),
            ),
          ),
        ),
      // Attendance: per-staff. Sum billed_staff_count across active
      // tenants for MRR; row count for the module-count card.
      db
        .select({
          tenants: count(),
          staff: sum(attendanceSettings.billedStaffCount),
        })
        .from(attendanceSettings)
        .where(
          and(
            eq(attendanceSettings.subscriptionActive, true),
            or(
              isNull(attendanceSettings.subscriptionExpiresAt),
              gte(attendanceSettings.subscriptionExpiresAt, now),
            ),
          ),
        ),
      // WhatsApp join: tier price lives in wa_subscription_plans.
      db
        .select({
          tier: waSettings.tier,
          price: waSubscriptionPlans.priceIdr,
        })
        .from(waSettings)
        .leftJoin(
          waSubscriptionPlans,
          eq(waSubscriptionPlans.planKey, waSettings.tier),
        )
        .where(
          and(
            sql`${waSettings.tier} != 'free'`,
            or(
              isNull(waSettings.subscriptionExpiresAt),
              gte(waSettings.subscriptionExpiresAt, now),
            ),
          ),
        ),
      db
        .select({ n: count() })
        .from(waInstances)
        .where(eq(waInstances.status, 'connected')),
      db
        .select()
        .from(platformAdminAuditLogs)
        .orderBy(desc(platformAdminAuditLogs.createdAt))
        .limit(10),
    ])

    // Bucket raw timestamps into 7 daily counts for sparklines.
    const newTenantsSpark = await dailyCountsLast7Days(
      newTenantsRaw.map((r) => r.createdAt),
    )
    const newMembersSpark = await dailyCountsLast7Days(
      newMembersRaw.map((r) => r.createdAt),
    )

    // Module counts.
    const attActiveTenants = Number(attActiveAgg[0]?.tenants ?? 0)
    const attBilledStaff = Number(attActiveAgg[0]?.staff ?? 0)
    const modulesActive = {
      pos: posActiveRows.length,
      inventory: invActiveRows.length,
      attendance: attActiveTenants,
      whatsapp: waActiveRows.length,
      total: 0,
    }
    modulesActive.total =
      modulesActive.pos +
      modulesActive.inventory +
      modulesActive.attendance +
      modulesActive.whatsapp

    // MRR — pos + inventory from constants (conservative annual rate),
    // whatsapp from the DB join, attendance from billed_staff_count ×
    // conservative per-staff rate.
    const posMrr = posActiveRows.reduce(
      (s, r) => s + tierMrr(POS_PLANS, r.tier),
      0,
    )
    const invMrr = invActiveRows.reduce(
      (s, r) => s + tierMrr(INVENTORY_PLANS, r.tier),
      0,
    )
    const waMrr = waActiveRows.reduce(
      (s, r) => s + Number(r.price ?? 0),
      0,
    )
    const attMrr = attBilledStaff * ATTENDANCE_PRICE_PER_STAFF_PER_MONTH

    return {
      newTenants: {
        last7: Number(newTenants7[0]?.n ?? 0),
        last30: Number(newTenants30[0]?.n ?? 0),
        spark: newTenantsSpark,
      },
      newMembers: {
        last7: Number(newMembers7[0]?.n ?? 0),
        last30: Number(newMembers30[0]?.n ?? 0),
        spark: newMembersSpark,
      },
      modulesActive,
      mrrIdr: {
        total: posMrr + invMrr + attMrr + waMrr,
        breakdown: {
          pos: posMrr,
          inventory: invMrr,
          attendance: attMrr,
          whatsapp: waMrr,
        },
      },
      activeWhatsappInstances: Number(activeWaInstancesRow[0]?.n ?? 0),
      recentActivity: recentAuditRows.map((r) => ({
        id: r.id,
        action: r.action,
        adminUserId: r.adminUserId,
        targetTenantId: r.targetTenantId ?? null,
        createdAt: r.createdAt.toISOString(),
        metadata: r.metadata ?? null,
      })),
    }
  },
)

// Helper exported for the future "30-day MRR trend" follow-up. Not used
// by the dashboard fn yet but kept here so the helpers all live together.
export function formatMrrLabel(idr: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(idr)
}
