import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  notifications,
  pushSubscriptions,
  tenants,
  tenantMembers,
  roles,
  attendanceSettings,
  platformAdminAuditLogs,
} from '@vintra/db/schema'
import { sql, eq, inArray, and, or } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import { NOTIFICATION_TYPES } from '@vintra/shared'
import { sendPushToUser } from '../push'

// ─── Validators ───────────────────────────────────────────────────

const audienceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('tenants'),
    tenantIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({
    mode: z.literal('roles'),
    roleKeys: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    mode: z.literal('modules'),
    moduleKeys: z.array(z.string().min(1)).min(1),
  }),
])

const broadcastInput = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(280),
  url: z.string().url().optional(),
  audience: audienceSchema,
})

const previewInput = z.object({ audience: audienceSchema })

type Audience = z.infer<typeof audienceSchema>

// ─── Recipient resolution ─────────────────────────────────────────

/**
 * Returns the de-duplicated set of user IDs that should receive a
 * broadcast given the audience selection. Owners and members are
 * unioned (an owner who isn't yet listed in tenant_members shouldn't
 * be missed). Uses Drizzle's query builder rather than raw SQL so
 * array parameter binding is handled correctly by the postgres-js
 * driver.
 */
async function resolveAudience(audience: Audience): Promise<string[]> {
  const userIdSet = new Set<string>()

  if (audience.mode === 'all') {
    const ownerRows = await db.select({ userId: tenants.ownerId }).from(tenants)
    ownerRows.forEach((r) => userIdSet.add(r.userId))
    const memberRows = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
    memberRows.forEach((r) => userIdSet.add(r.userId))
    return Array.from(userIdSet)
  }

  if (audience.mode === 'tenants') {
    if (audience.tenantIds.length === 0) return []
    const ownerRows = await db
      .select({ userId: tenants.ownerId })
      .from(tenants)
      .where(inArray(tenants.id, audience.tenantIds))
    ownerRows.forEach((r) => userIdSet.add(r.userId))
    const memberRows = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(inArray(tenantMembers.tenantId, audience.tenantIds))
    memberRows.forEach((r) => userIdSet.add(r.userId))
    return Array.from(userIdSet)
  }

  if (audience.mode === 'roles') {
    const wantsOwner = audience.roleKeys.includes('owner')
    const otherRoles = audience.roleKeys.filter((k) => k !== 'owner')

    // Owners come from tenants.owner_id directly. tenant_members.role
    // is also 'owner' for the founder seat, but using tenants.owner_id
    // catches edge cases where the membership row is missing.
    if (wantsOwner) {
      const ownerRows = await db
        .select({ userId: tenants.ownerId })
        .from(tenants)
      ownerRows.forEach((r) => userIdSet.add(r.userId))
    }

    if (otherRoles.length > 0) {
      const memberRows = await db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .leftJoin(roles, eq(tenantMembers.roleId, roles.id))
        .where(
          // Match against the resolved role key OR the legacy text role
          // column — older membership rows may not have role_id set.
          or(
            inArray(roles.key, otherRoles),
            inArray(tenantMembers.role, otherRoles),
          ),
        )
      memberRows.forEach((r) => userIdSet.add(r.userId))
    }

    return Array.from(userIdSet)
  }

  // mode === 'modules'
  // Only attendance has subscription tracking today. When more paid
  // modules ship, replicate the join pattern for each module's
  // settings table.
  const wantsAttendance = audience.moduleKeys.includes('attendance')
  if (!wantsAttendance) return []

  // Active = paid subscription not expired OR trial still running.
  const now = new Date()
  const moduleActiveCondition = or(
    and(
      eq(attendanceSettings.subscriptionActive, true),
      sql`${attendanceSettings.subscriptionExpiresAt} > ${now}`,
    ),
    sql`${attendanceSettings.trialEndsAt} IS NOT NULL AND ${attendanceSettings.trialEndsAt} > ${now}`,
  )

  const ownerRows = await db
    .select({ userId: tenants.ownerId })
    .from(tenants)
    .innerJoin(
      attendanceSettings,
      eq(attendanceSettings.tenantId, tenants.id),
    )
    .where(moduleActiveCondition)
  ownerRows.forEach((r) => userIdSet.add(r.userId))

  const memberRows = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .innerJoin(
      attendanceSettings,
      eq(attendanceSettings.tenantId, tenantMembers.tenantId),
    )
    .where(moduleActiveCondition)
  memberRows.forEach((r) => userIdSet.add(r.userId))

  return Array.from(userIdSet)
}

// ─── Server functions ─────────────────────────────────────────────

/**
 * Returns the audience size without sending. Used by the admin form
 * to show "akan dikirim ke N pengguna" before submit.
 */
export const previewBroadcastRecipientCount = createServerFn({ method: 'POST' })
  .inputValidator(previewInput)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const userIds = await resolveAudience(data.audience)
    return { count: userIds.length }
  })

/**
 * Send a broadcast notification. Inserts one notification row per
 * recipient (so each user can mark/dismiss independently), then fans
 * out Web Push deliveries in parallel chunks.
 *
 * No `source_key` on these rows — broadcasts are intentionally
 * non-deduplicated (an admin re-sending the same content should
 * deliver again, not silently no-op).
 */
export const broadcastNotification = createServerFn({ method: 'POST' })
  .inputValidator(broadcastInput)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()
    const userIds = await resolveAudience(data.audience)
    if (userIds.length === 0) {
      return { ok: true, recipientCount: 0 }
    }

    // Bulk insert notification rows.
    await db.insert(notifications).values(
      userIds.map((userId) => ({
        userId,
        tenantId: null,
        type: NOTIFICATION_TYPES.adminBroadcast,
        title: data.title,
        body: data.body,
        url: data.url ?? null,
      })),
    )

    // Fan out push deliveries in chunks of 50 to avoid overwhelming
    // browser-vendor push servers all at once.
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds))

    const subsByUser = new Map<string, typeof subs>()
    for (const s of subs) {
      const arr = subsByUser.get(s.userId) ?? []
      arr.push(s)
      subsByUser.set(s.userId, arr)
    }

    const CHUNK = 50
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const chunk = userIds.slice(i, i + CHUNK)
      await Promise.all(
        chunk.map((uid) =>
          sendPushToUser(uid, {
            title: data.title,
            body: data.body,
            url: data.url,
          }),
        ),
      )
    }

    await db.insert(platformAdminAuditLogs).values({
      adminUserId: auth.userId,
      action: 'broadcast_notification',
      metadata: {
        audience: data.audience,
        title: data.title,
        recipientCount: userIds.length,
      },
    })

    return { ok: true, recipientCount: userIds.length }
  })
