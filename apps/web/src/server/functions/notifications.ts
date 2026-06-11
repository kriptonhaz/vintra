import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { notifications, pushSubscriptions } from '@vintra/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'

// ─── Read-side ────────────────────────────────────────────────────

const listInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
})

export const listNotifications = createServerFn({ method: 'POST' })
  .inputValidator(listInput)
  .handler(async ({ data }) => {
    const { userId } = await requireAuth()
    const offset = (data.page - 1) * data.pageSize

    const [items, totalRow, unreadRow] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(eq(notifications.userId, userId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), isNull(notifications.readAt)),
        ),
    ])

    return {
      items,
      total: totalRow[0]?.count ?? 0,
      unreadCount: unreadRow[0]?.count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

const recentInput = z.object({
  limit: z.number().int().min(1).max(20).default(5),
})

export const getRecentNotifications = createServerFn({ method: 'POST' })
  .inputValidator(recentInput)
  .handler(async ({ data }) => {
    const { userId } = await requireAuth()
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(data.limit)
    return rows
  })

export const getUnreadCount = createServerFn().handler(async () => {
  const { userId } = await requireAuth()
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return { count: row?.count ?? 0 }
})

// ─── Mutations ────────────────────────────────────────────────────

const idInput = z.object({ id: z.string().uuid() })

export const markNotificationRead = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const { userId } = await requireAuth()
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, data.id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
    return { ok: true }
  })

export const markAllNotificationsRead = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { userId } = await requireAuth()
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      )
    return { ok: true }
  })

export const deleteNotification = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const { userId } = await requireAuth()
    await db
      .delete(notifications)
      .where(
        and(eq(notifications.id, data.id), eq(notifications.userId, userId)),
      )
    return { ok: true }
  })

// ─── Push subscription register / unregister ──────────────────────

const registerInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().optional(),
})

export const registerPushSubscription = createServerFn({ method: 'POST' })
  .inputValidator(registerInput)
  .handler(async ({ data }) => {
    const { userId } = await requireAuth()
    // Upsert by endpoint: a re-subscription from the same browser
    // (e.g., after permission re-grant) updates the keys + ownership
    // rather than failing on the unique constraint.
    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        userAgent: data.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh: data.p256dh,
          auth: data.auth,
          userAgent: data.userAgent ?? null,
          lastSeenAt: new Date(),
        },
      })
    return { ok: true }
  })

const unregisterInput = z.object({ endpoint: z.string().url() })

export const unregisterPushSubscription = createServerFn({ method: 'POST' })
  .inputValidator(unregisterInput)
  .handler(async ({ data }) => {
    const { userId } = await requireAuth()
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, data.endpoint),
          eq(pushSubscriptions.userId, userId),
        ),
      )
    return { ok: true }
  })

/**
 * Has the current user registered a push subscription on any device?
 * Used by the bell icon to show a "Aktifkan notifikasi" nudge dot
 * when no subscriptions exist.
 */
export const getPushSubscriptionStatus = createServerFn().handler(async () => {
  const { userId } = await requireAuth()
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .limit(1)
  return { subscribed: !!row }
})
