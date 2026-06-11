/**
 * In-process notification scheduler. Ticks every minute and inserts
 * any time-based notifications that are due.
 *
 * Lives inside the PM2 web process. We run TWO fork-mode apps for
 * zero-downtime deploys (vintra-web-a on :3000, -b on :3001), so
 * the scheduler is pinned to ONE instance via the `PORT === '3000'`
 * gate below — otherwise every tick would double-fire.
 *
 * Idempotency: every insert here passes a `sourceKey` that is unique
 * per logical event (e.g., `${tenantId}-${trialEndDate}-expiring`),
 * combined with the partial unique index on
 * `(user_id, type, source_key)`. Even if the gate ever broke
 * (someone changed port assignments without re-reading this) the
 * worst case is duplicate-query waste, not double notifications.
 */
import cron from 'node-cron'
import { db } from '@vintra/db'
import {
  attendanceSettings,
  staffProfiles,
  tenants,
  inventorySettings,
  posSettings,
  apPayables,
  apPayments,
} from '@vintra/db/schema'
import { sql, and, eq, or } from 'drizzle-orm'
import { NOTIFICATION_TYPES } from '@vintra/shared'
import { createNotification } from './notifications'
import { sendDueFeedbackReplyEmails } from './feedback-notifications'
import { resolveStaffScheduleForDow } from './attendance-schedule'
import { jakartaDayOfWeek, dateKeyJakarta } from '@/lib/jakarta-time'

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000
const TICK_WINDOW_MS = 60_000 // tolerate up to 1 minute drift between cron and wall clock

declare global {
  // eslint-disable-next-line no-var
  var __jq_scheduler_started: boolean | undefined
}

export function startScheduler() {
  // Belt-and-suspenders: never run in a browser bundle, never re-register.
  if (typeof window !== 'undefined') return
  if (globalThis.__jq_scheduler_started) return
  // Local dev: skip the scheduler. Running it inside the Vite dev
  // process — which constantly blocks the event loop compiling on
  // demand — produces noisy node-cron "missed execution" warnings and
  // stale-connection ETIMEDOUTs, and there are no real reminders to
  // send locally. Opt back in with RUN_SCHEDULER=1 if you need to test
  // a tick against your dev DB.
  if (process.env.NODE_ENV !== 'production' && process.env.RUN_SCHEDULER !== '1') {
    console.log('[scheduler] skipped in dev (set RUN_SCHEDULER=1 to enable)')
    return
  }
  // Multi-instance: scheduler must run on ONLY ONE process or
  // every tick double-fires. PORT 3000 = vintra-web-a (the
  // scheduler-owner). PORT 3001 = vintra-web-b (skips).
  // Unset PORT = single-process dev mode → run normally.
  const port = process.env.PORT
  if (port && port !== '3000') {
    console.log(`[scheduler] skipping on PORT=${port} (pinned to 3000)`)
    return
  }
  globalThis.__jq_scheduler_started = true

  console.log('[scheduler] starting (1-min tick)')

  cron.schedule('* * * * *', async () => {
    try {
      await tickTrialReminders()
      await tickSubscriptionReminders()
      await tickAttendanceReminders()
    } catch (err) {
      console.error('[scheduler] tick failed:', err)
    }
  })

  // Daily 07:00 WIB (UTC 00:00). Inventory low-stock digest +
  // inventory subscription/trial expiry reminders + POS trial/sub
  // reminders. Daily cadence because none of these are time-of-day
  // urgent and we don't want to spam the owner every minute.
  cron.schedule('0 0 * * *', async () => {
    try {
      await tickInventoryLowStock()
      await tickInventoryTrialReminders()
      await tickInventorySubscriptionReminders()
      await tickPOSTrialReminders()
      await tickPOSSubscriptionReminders()
      await tickCicilanReminders()
      await sendDueFeedbackReplyEmails()
    } catch (err) {
      console.error('[scheduler] daily tick failed:', err)
    }
  })

  // 23:30 WIB end-of-day = 16:30 UTC. POS Z-report digest for Toko+
  // tenants. Fires once per branch with at least 1 sale today; one
  // notification per tenant aggregated across their branches.
  cron.schedule('30 16 * * *', async () => {
    try {
      await tickPOSDailyZReport()
    } catch (err) {
      console.error('[scheduler] zreport tick failed:', err)
    }
  })
}

// ─── Trial reminders ──────────────────────────────────────────────

async function tickTrialReminders() {
  // Trial expiring in the next 24h.
  const expiringRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      trialEndsAt: attendanceSettings.trialEndsAt,
    })
    .from(tenants)
    .innerJoin(attendanceSettings, eq(attendanceSettings.tenantId, tenants.id))
    .where(
      sql`${attendanceSettings.trialEndsAt} IS NOT NULL
          AND ${attendanceSettings.trialEndsAt} > now()
          AND ${attendanceSettings.trialEndsAt} <= now() + interval '24 hours'`,
    )

  for (const r of expiringRows) {
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.trialExpiringSoon,
      title: 'Trial Akan Berakhir',
      body: `Trial Absensi untuk ${r.tenantName} akan berakhir kurang dari 24 jam lagi. Berlangganan sekarang untuk melanjutkan.`,
      url: '/attendance/billing',
      sourceKey: r.tenantId,
    })
  }

  // Trial that just expired in the last hour.
  const expiredRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
    })
    .from(tenants)
    .innerJoin(attendanceSettings, eq(attendanceSettings.tenantId, tenants.id))
    .where(
      sql`${attendanceSettings.trialEndsAt} IS NOT NULL
          AND ${attendanceSettings.trialEndsAt} <= now()
          AND ${attendanceSettings.trialEndsAt} > now() - interval '1 hour'`,
    )

  for (const r of expiredRows) {
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.trialExpired,
      title: 'Trial Telah Berakhir',
      body: `Masa trial Absensi untuk ${r.tenantName} telah berakhir. Berlangganan sekarang untuk mengaktifkan kembali.`,
      url: '/attendance/billing',
      sourceKey: r.tenantId,
    })
  }
}

// ─── Subscription expiry reminders ────────────────────────────────

async function tickSubscriptionReminders() {
  // 7-day window: expires between now+6.5d and now+7d.
  const sevenDayRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      expiresAt: attendanceSettings.subscriptionExpiresAt,
    })
    .from(tenants)
    .innerJoin(attendanceSettings, eq(attendanceSettings.tenantId, tenants.id))
    .where(
      sql`${attendanceSettings.subscriptionActive} = true
          AND ${attendanceSettings.subscriptionExpiresAt} IS NOT NULL
          AND ${attendanceSettings.subscriptionExpiresAt} > now() + interval '6 days 12 hours'
          AND ${attendanceSettings.subscriptionExpiresAt} <= now() + interval '7 days'`,
    )

  for (const r of sevenDayRows) {
    if (!r.expiresAt) continue
    const expiresKey = r.expiresAt.toISOString().slice(0, 10)
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.subExpiringSoon7d,
      title: 'Langganan Akan Berakhir 7 Hari Lagi',
      body: `Langganan Absensi untuk ${r.tenantName} akan berakhir dalam 7 hari. Perpanjang sebelum kadaluarsa.`,
      url: '/attendance/billing',
      sourceKey: `${r.tenantId}-${expiresKey}`,
    })
  }

  // 1-day window: expires between now+23h and now+24h.
  const oneDayRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      expiresAt: attendanceSettings.subscriptionExpiresAt,
    })
    .from(tenants)
    .innerJoin(attendanceSettings, eq(attendanceSettings.tenantId, tenants.id))
    .where(
      sql`${attendanceSettings.subscriptionActive} = true
          AND ${attendanceSettings.subscriptionExpiresAt} IS NOT NULL
          AND ${attendanceSettings.subscriptionExpiresAt} > now() + interval '23 hours'
          AND ${attendanceSettings.subscriptionExpiresAt} <= now() + interval '24 hours'`,
    )

  for (const r of oneDayRows) {
    if (!r.expiresAt) continue
    const expiresKey = r.expiresAt.toISOString().slice(0, 10)
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.subExpiringSoon1d,
      title: 'Langganan Akan Berakhir Besok',
      body: `Langganan Absensi untuk ${r.tenantName} akan berakhir dalam 24 jam.`,
      url: '/attendance/billing',
      sourceKey: `${r.tenantId}-${expiresKey}`,
    })
  }
}

// ─── Clock-in / clock-out reminders ───────────────────────────────

/**
 * For each tenant with reminders enabled, walk every active staff,
 * resolve their schedule for today's day-of-week, and check whether
 * the (clockTime ± offset) falls inside the current 1-minute tick
 * window. If so, fire the reminder.
 *
 * Idempotency: source_key includes the date and the type of reminder,
 * so each staff gets at most one clock-in reminder + one clock-out
 * reminder per Jakarta calendar day.
 */
async function tickAttendanceReminders() {
  const now = new Date()
  const dow = jakartaDayOfWeek(now)
  const dateKey = dateKeyJakarta(now)

  const settings = await db
    .select({
      tenantId: attendanceSettings.tenantId,
      clockinEnabled: attendanceSettings.clockinReminderEnabled,
      clockinMinutes: attendanceSettings.clockinReminderMinutes,
      clockinDirection: attendanceSettings.clockinReminderDirection,
      clockoutEnabled: attendanceSettings.clockoutReminderEnabled,
      clockoutMinutes: attendanceSettings.clockoutReminderMinutes,
      clockoutDirection: attendanceSettings.clockoutReminderDirection,
    })
    .from(attendanceSettings)
    .where(
      or(
        eq(attendanceSettings.clockinReminderEnabled, true),
        eq(attendanceSettings.clockoutReminderEnabled, true),
      ),
    )

  for (const s of settings) {
    const staff = await db
      .select({
        id: staffProfiles.id,
        userId: staffProfiles.userId,
        branchId: staffProfiles.branchId,
        branchShiftId: staffProfiles.branchShiftId,
      })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.tenantId, s.tenantId),
          eq(staffProfiles.isActive, true),
        ),
      )

    for (const st of staff) {
      const schedule = await resolveStaffScheduleForDow(st, dow)
      if (!schedule || !schedule.isWorkDay) continue

      if (s.clockinEnabled && schedule.clockInTime) {
        await maybeFireReminder({
          tenantId: s.tenantId,
          staffId: st.id,
          userId: st.userId,
          dateKey,
          now,
          scheduledHHmmss: schedule.clockInTime,
          minutes: s.clockinMinutes,
          direction: s.clockinDirection as 'before' | 'after',
          kind: 'clockin',
        })
      }
      if (s.clockoutEnabled && schedule.clockOutTime) {
        await maybeFireReminder({
          tenantId: s.tenantId,
          staffId: st.id,
          userId: st.userId,
          dateKey,
          now,
          scheduledHHmmss: schedule.clockOutTime,
          minutes: s.clockoutMinutes,
          direction: s.clockoutDirection as 'before' | 'after',
          kind: 'clockout',
        })
      }
    }
  }
}

interface MaybeFireInput {
  tenantId: string
  staffId: string
  userId: string
  dateKey: string
  now: Date
  scheduledHHmmss: string
  minutes: number
  direction: 'before' | 'after'
  kind: 'clockin' | 'clockout'
}

async function maybeFireReminder(input: MaybeFireInput) {
  const fireAtUtcMs = jakartaWallTimeToUtcMs(input.scheduledHHmmss, input.dateKey)
  if (fireAtUtcMs === null) return
  const sign = input.direction === 'after' ? 1 : -1
  const offsetUtcMs = fireAtUtcMs + sign * input.minutes * 60_000

  if (Math.abs(offsetUtcMs - input.now.getTime()) > TICK_WINDOW_MS) return

  const isClockin = input.kind === 'clockin'
  const title = isClockin ? 'Pengingat Clock-In' : 'Pengingat Clock-Out'
  const body =
    input.direction === 'before'
      ? `${input.minutes} menit lagi waktu ${isClockin ? 'clock-in' : 'clock-out'}. Jangan lupa absen.`
      : `Sudah ${input.minutes} menit lewat jadwal — jangan lupa ${isClockin ? 'clock-in' : 'clock-out'}.`

  await createNotification({
    userId: input.userId,
    tenantId: input.tenantId,
    type: isClockin
      ? NOTIFICATION_TYPES.clockInReminder
      : NOTIFICATION_TYPES.clockOutReminder,
    title,
    body,
    url: '/attendance/check-in',
    sourceKey: `${input.staffId}-${input.dateKey}-${input.kind}`,
  })
}

/**
 * Convert a Jakarta-wall-clock HH:mm:ss + YYYY-MM-DD into a UTC
 * milliseconds-since-epoch value. Returns null on malformed input.
 */
function jakartaWallTimeToUtcMs(
  hhmmss: string,
  dateKeyYmd: string,
): number | null {
  const [hStr, mStr, sStr] = hhmmss.split(':')
  const [yStr, monStr, dStr] = dateKeyYmd.split('-')
  const h = Number(hStr),
    m = Number(mStr),
    s = Number(sStr ?? '0')
  const y = Number(yStr),
    mon = Number(monStr),
    d = Number(dStr)
  if ([h, m, s, y, mon, d].some(Number.isNaN)) return null
  // Build the wall-clock instant as if it were UTC, then subtract the
  // offset to get the true UTC equivalent.
  const wallAsUtc = Date.UTC(y, mon - 1, d, h, m, s)
  return wallAsUtc - JAKARTA_OFFSET_MS
}

// ─── Inventory ticks (daily) ─────────────────────────────────────────

/**
 * Daily low-stock digest. For each tenant with low_stock_alerts_enabled
 * AND tier in (toko/bisnis/multi_outlet) OR active trial, batch the
 * top-5 below-threshold items into one notification. Source key is
 * tenant + date so we never fire twice the same day.
 */
async function tickInventoryLowStock() {
  const dateKey = dateKeyJakarta(new Date())
  // Resolve tenants with the feature enabled (paid sub or active trial)
  // AND low_stock_alerts_enabled = true. We do this inline in SQL so a
  // tenant scan doesn't pull every settings row into Node memory.
  const candidates = await db.execute<{
    tenant_id: string
    owner_id: string
    business_name: string
  }>(sql`
    SELECT t.id AS tenant_id, t.owner_id, t.business_name
    FROM tenants t
    JOIN inventory_settings s ON s.tenant_id = t.id
    WHERE s.low_stock_alerts_enabled = true
      AND (
        (s.subscription_active = true AND s.subscription_expires_at > now())
        OR (s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now())
      )
  `)

  for (const c of candidates) {
    // Top 5 items below threshold, summed across branches.
    const lowItems = await db.execute<{
      id: string
      name: string
      total_qty: string
      min_stock_level: string
    }>(sql`
      SELECT i.id, i.name,
             COALESCE(SUM(b.quantity), 0) AS total_qty,
             i.min_stock_level
      FROM inventory_items i
      LEFT JOIN inventory_stock_balances b ON b.item_id = i.id
      WHERE i.tenant_id = ${c.tenant_id}
        AND i.is_active = true
        AND i.min_stock_level IS NOT NULL
      GROUP BY i.id, i.min_stock_level
      HAVING COALESCE(SUM(b.quantity), 0) < i.min_stock_level
      ORDER BY (i.min_stock_level - COALESCE(SUM(b.quantity), 0)) DESC
      LIMIT 5
    `)
    if (lowItems.length === 0) continue

    const top = lowItems
      .map((i) => `• ${i.name} (sisa ${Number(i.total_qty)})`)
      .join('\n')

    // Single-item alert → deep-link straight to that item's detail
    // page (both web /inventory/items/<id> and the mobile /inventory/<id>
    // route resolve correctly via the mobile notification router). The
    // multi-item rollup keeps the filtered-list URL since no single
    // item represents the alert.
    const onlyItem = lowItems.length === 1 ? lowItems[0] : null
    const url = onlyItem
      ? `/inventory/items/${onlyItem.id}`
      : '/inventory/items?lowStock=1'
    const title = onlyItem
      ? `Stok menipis: ${onlyItem.name}`
      : `Stok Menipis (${lowItems.length} item)`

    await createNotification({
      userId: c.owner_id,
      tenantId: c.tenant_id,
      type: NOTIFICATION_TYPES.inventoryLowStock,
      title,
      body: `${top}${lowItems.length === 5 ? '\n…dan beberapa item lainnya.' : ''}`,
      url,
      data: onlyItem ? { itemId: onlyItem.id } : undefined,
      sourceKey: `${c.tenant_id}-low-stock-${dateKey}`,
    })
  }
}

async function tickInventoryTrialReminders() {
  // 24h before trial ends.
  const expiringRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      trialEndsAt: inventorySettings.trialEndsAt,
    })
    .from(tenants)
    .innerJoin(inventorySettings, eq(inventorySettings.tenantId, tenants.id))
    .where(
      sql`${inventorySettings.trialEndsAt} IS NOT NULL
          AND ${inventorySettings.trialEndsAt} > now()
          AND ${inventorySettings.trialEndsAt} <= now() + interval '24 hours'`,
    )
  for (const r of expiringRows) {
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.inventoryTrialExpiringSoon,
      title: 'Trial Inventory Akan Berakhir',
      body: `Trial Inventory untuk ${r.tenantName} akan berakhir kurang dari 24 jam lagi. Berlangganan sekarang untuk melanjutkan fitur Toko.`,
      url: '/inventory/billing',
      sourceKey: r.tenantId,
    })
  }

  // Just-expired trials.
  const expiredRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
    })
    .from(tenants)
    .innerJoin(inventorySettings, eq(inventorySettings.tenantId, tenants.id))
    .where(
      sql`${inventorySettings.trialEndsAt} IS NOT NULL
          AND ${inventorySettings.trialEndsAt} <= now()
          AND ${inventorySettings.trialEndsAt} > now() - interval '25 hours'`,
    )
  for (const r of expiredRows) {
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.inventoryTrialExpired,
      title: 'Trial Inventory Telah Berakhir',
      body: `Masa trial Inventory untuk ${r.tenantName} telah berakhir. Anda kembali ke paket Free — data tetap aman.`,
      url: '/inventory/billing',
      sourceKey: r.tenantId,
    })
  }
}

async function tickInventorySubscriptionReminders() {
  // 7-day reminder
  const sevenDay = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      expiresAt: inventorySettings.subscriptionExpiresAt,
    })
    .from(tenants)
    .innerJoin(inventorySettings, eq(inventorySettings.tenantId, tenants.id))
    .where(
      sql`${inventorySettings.subscriptionActive} = true
          AND ${inventorySettings.subscriptionExpiresAt} IS NOT NULL
          AND ${inventorySettings.subscriptionExpiresAt} > now() + interval '6 days 12 hours'
          AND ${inventorySettings.subscriptionExpiresAt} <= now() + interval '7 days 12 hours'`,
    )
  for (const r of sevenDay) {
    if (!r.expiresAt) continue
    const dateKey = r.expiresAt.toISOString().slice(0, 10)
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.inventorySubExpiringSoon7d,
      title: 'Langganan Inventory Akan Berakhir 7 Hari Lagi',
      body: `Langganan Inventory untuk ${r.tenantName} akan berakhir dalam 7 hari. Perpanjang sebelum kadaluarsa.`,
      url: '/inventory/billing',
      sourceKey: `${r.tenantId}-${dateKey}`,
    })
  }

  // 1-day reminder
  const oneDay = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      expiresAt: inventorySettings.subscriptionExpiresAt,
    })
    .from(tenants)
    .innerJoin(inventorySettings, eq(inventorySettings.tenantId, tenants.id))
    .where(
      sql`${inventorySettings.subscriptionActive} = true
          AND ${inventorySettings.subscriptionExpiresAt} IS NOT NULL
          AND ${inventorySettings.subscriptionExpiresAt} > now() + interval '12 hours'
          AND ${inventorySettings.subscriptionExpiresAt} <= now() + interval '36 hours'`,
    )
  for (const r of oneDay) {
    if (!r.expiresAt) continue
    const dateKey = r.expiresAt.toISOString().slice(0, 10)
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.inventorySubExpiringSoon1d,
      title: 'Langganan Inventory Akan Berakhir Besok',
      body: `Langganan Inventory untuk ${r.tenantName} akan berakhir dalam 24 jam.`,
      url: '/inventory/billing',
      sourceKey: `${r.tenantId}-${dateKey}-1d`,
    })
  }
}

// ─── Cicilan / AP due-date reminders (daily, JUR-158) ────────────────

/**
 * Notify the tenant owner about cicilan installments due within the
 * next 3 days. Idempotent per installment via `cicilan-due-<paymentId>`
 * — each installment yields at most one reminder, ever. Payables with
 * `reminders_muted` are skipped.
 */
async function tickCicilanReminders() {
  const rows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      paymentId: apPayments.id,
      payableName: apPayables.name,
      dueDate: apPayments.dueDate,
      amount: apPayments.amount,
    })
    .from(apPayments)
    .innerJoin(apPayables, eq(apPayables.id, apPayments.payableId))
    .innerJoin(tenants, eq(tenants.id, apPayables.tenantId))
    .where(
      sql`${apPayments.paidAt} IS NULL
          AND ${apPayables.remindersMuted} = false
          AND ${apPayments.dueDate} >= (now() AT TIME ZONE 'Asia/Jakarta')::date
          AND ${apPayments.dueDate} <= ((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '3 days')`,
    )

  for (const r of rows) {
    const amount = Number(r.amount).toLocaleString('id-ID')
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.cicilanDueSoon,
      title: 'Cicilan akan jatuh tempo',
      body: `Cicilan "${r.payableName}" sebesar Rp ${amount} jatuh tempo ${r.dueDate}.`,
      url: '/cashflow/cicilan',
      sourceKey: `cicilan-due-${r.paymentId}`,
    })
  }
}

// ─── POS ticks (daily) ───────────────────────────────────────────────

async function tickPOSTrialReminders() {
  // 24h before trial ends.
  const expiringRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      trialEndsAt: posSettings.trialEndsAt,
    })
    .from(tenants)
    .innerJoin(posSettings, eq(posSettings.tenantId, tenants.id))
    .where(
      sql`${posSettings.trialEndsAt} IS NOT NULL
          AND ${posSettings.trialEndsAt} > now()
          AND ${posSettings.trialEndsAt} <= now() + interval '24 hours'`,
    )
  for (const r of expiringRows) {
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.posTrialExpiringSoon,
      title: 'Trial Kasir Akan Berakhir',
      body: `Trial Kasir untuk ${r.tenantName} akan berakhir kurang dari 24 jam lagi. Berlangganan sekarang untuk melanjutkan fitur Toko.`,
      url: '/pos/billing',
      sourceKey: r.tenantId,
    })
  }

  // Just-expired trials.
  const expiredRows = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
    })
    .from(tenants)
    .innerJoin(posSettings, eq(posSettings.tenantId, tenants.id))
    .where(
      sql`${posSettings.trialEndsAt} IS NOT NULL
          AND ${posSettings.trialEndsAt} <= now()
          AND ${posSettings.trialEndsAt} > now() - interval '25 hours'`,
    )
  for (const r of expiredRows) {
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.posTrialExpired,
      title: 'Trial Kasir Telah Berakhir',
      body: `Masa trial Kasir untuk ${r.tenantName} telah berakhir. Anda kembali ke paket Free — data tetap aman.`,
      url: '/pos/billing',
      sourceKey: r.tenantId,
    })
  }
}

async function tickPOSSubscriptionReminders() {
  const sevenDay = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      expiresAt: posSettings.subscriptionExpiresAt,
    })
    .from(tenants)
    .innerJoin(posSettings, eq(posSettings.tenantId, tenants.id))
    .where(
      sql`${posSettings.subscriptionActive} = true
          AND ${posSettings.subscriptionExpiresAt} IS NOT NULL
          AND ${posSettings.subscriptionExpiresAt} > now() + interval '6 days 12 hours'
          AND ${posSettings.subscriptionExpiresAt} <= now() + interval '7 days 12 hours'`,
    )
  for (const r of sevenDay) {
    if (!r.expiresAt) continue
    const dateKey = r.expiresAt.toISOString().slice(0, 10)
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.posSubExpiringSoon7d,
      title: 'Langganan Kasir Akan Berakhir 7 Hari Lagi',
      body: `Langganan Kasir untuk ${r.tenantName} akan berakhir dalam 7 hari. Perpanjang sebelum kadaluarsa.`,
      url: '/pos/billing',
      sourceKey: `${r.tenantId}-${dateKey}`,
    })
  }

  const oneDay = await db
    .select({
      tenantId: tenants.id,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
      expiresAt: posSettings.subscriptionExpiresAt,
    })
    .from(tenants)
    .innerJoin(posSettings, eq(posSettings.tenantId, tenants.id))
    .where(
      sql`${posSettings.subscriptionActive} = true
          AND ${posSettings.subscriptionExpiresAt} IS NOT NULL
          AND ${posSettings.subscriptionExpiresAt} > now() + interval '12 hours'
          AND ${posSettings.subscriptionExpiresAt} <= now() + interval '36 hours'`,
    )
  for (const r of oneDay) {
    if (!r.expiresAt) continue
    const dateKey = r.expiresAt.toISOString().slice(0, 10)
    await createNotification({
      userId: r.ownerId,
      tenantId: r.tenantId,
      type: NOTIFICATION_TYPES.posSubExpiringSoon1d,
      title: 'Langganan Kasir Akan Berakhir Besok',
      body: `Langganan Kasir untuk ${r.tenantName} akan berakhir dalam 24 jam.`,
      url: '/pos/billing',
      sourceKey: `${r.tenantId}-${dateKey}-1d`,
    })
  }
}

/**
 * Daily Z-report digest. Runs at 23:30 Jakarta. For each Toko+ tenant
 * (paid OR trial) with at least one completed sale today, fire one
 * notification with the day's totals + a deep link to the sales page
 * pre-filtered to today. Idempotent via `${tenantId}-zreport-${dateKey}`.
 *
 * Tenants on Free skip — Z-report is a Toko+ feature.
 */
async function tickPOSDailyZReport() {
  const dateKey = dateKeyJakarta(new Date())
  const candidates = await db.execute<{
    tenant_id: string
    owner_id: string
    business_name: string
    sales_count: string
    total_revenue: string
  }>(sql`
    SELECT t.id AS tenant_id, t.owner_id, t.business_name,
           COUNT(s.id) AS sales_count,
           COALESCE(SUM(s.total::numeric), 0) AS total_revenue
    FROM tenants t
    JOIN pos_settings ps ON ps.tenant_id = t.id
    JOIN pos_sales s ON s.tenant_id = t.id
                    AND s.status = 'completed'
                    AND s.created_at >= ((now() AT TIME ZONE 'Asia/Jakarta')::date::timestamp) AT TIME ZONE 'Asia/Jakarta'
                    AND s.created_at <  (((now() AT TIME ZONE 'Asia/Jakarta')::date + interval '1 day')::timestamp) AT TIME ZONE 'Asia/Jakarta'
    WHERE (
      (ps.subscription_active = true AND ps.subscription_expires_at > now())
      OR (ps.trial_ends_at IS NOT NULL AND ps.trial_ends_at > now())
    )
    GROUP BY t.id, t.owner_id, t.business_name
    HAVING COUNT(s.id) > 0
  `)

  for (const c of candidates) {
    const count = Number(c.sales_count)
    const revenue = Number(c.total_revenue)
    const formattedRevenue = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(revenue)
    await createNotification({
      userId: c.owner_id,
      tenantId: c.tenant_id,
      type: NOTIFICATION_TYPES.posDailyZReportReady,
      title: `Z-Report ${dateKey} siap`,
      body: `${count} transaksi hari ini, total ${formattedRevenue}. Buka untuk lihat detail dan unduh PDF.`,
      url: `/pos/sales?date=${dateKey}`,
      sourceKey: `${c.tenant_id}-zreport-${dateKey}`,
    })
  }
}
