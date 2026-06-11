/**
 * Comp / free-access grants (JUR-194).
 *
 * A comp activates a module at Rp 0 with a mandatory reason. It is
 * NEVER written to `financial_transactions` — `comp_grants` is the only
 * record — so a comp can't inflate revenue. The founder applies one
 * directly; a non-founder admin's request waits as `pending` for the
 * founder to approve.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  compGrants,
  platformAdmins,
  tenants,
  posSettings,
  inventorySettings,
  attendanceSettings,
  waSettings,
} from '@vintra/db/schema'
import { eq, desc } from 'drizzle-orm'
import { NOTIFICATION_TYPES } from '@vintra/shared'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import { createNotification } from '../notifications'

async function isFounder(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ f: platformAdmins.isFounder })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1)
  return row?.f ?? false
}

/**
 * Activate the comped module(s) by upserting the settings table(s) and
 * appending to `tenants.active_modules`. A `komplit` POS comp also
 * lights up the bundled Inventory + Attendance, mirroring the paid
 * Komplit bundle. Returns the subscription expiry it set.
 */
async function applyCompGrant(
  exec: typeof db,
  input: {
    tenantId: string
    moduleKey: string
    planKey: string
    durationMonths: number
  },
): Promise<Date> {
  const now = new Date()
  const expiresAt = new Date(now)
  expiresAt.setMonth(expiresAt.getMonth() + input.durationMonths)
  const modules: string[] = []

  if (input.moduleKey === 'pos') {
    await exec
      .insert(posSettings)
      .values({
        tenantId: input.tenantId,
        tier: input.planKey,
        subscriptionActive: true,
        subscriptionStartedAt: now,
        subscriptionExpiresAt: expiresAt,
      })
      .onConflictDoUpdate({
        target: posSettings.tenantId,
        set: {
          tier: input.planKey,
          subscriptionActive: true,
          subscriptionStartedAt: now,
          subscriptionExpiresAt: expiresAt,
          updatedAt: now,
        },
      })
    modules.push('pos')

    if (input.planKey === 'komplit') {
      // Komplit bundles Inventory (Toko tier) + unlimited Attendance.
      await exec
        .insert(inventorySettings)
        .values({
          tenantId: input.tenantId,
          tier: 'toko',
          subscriptionActive: true,
          subscriptionStartedAt: now,
          subscriptionExpiresAt: expiresAt,
        })
        .onConflictDoUpdate({
          target: inventorySettings.tenantId,
          set: {
            tier: 'toko',
            subscriptionActive: true,
            subscriptionStartedAt: now,
            subscriptionExpiresAt: expiresAt,
            updatedAt: now,
          },
        })
      await exec
        .insert(attendanceSettings)
        .values({
          tenantId: input.tenantId,
          subscriptionActive: true,
          subscriptionStartedAt: now,
          subscriptionExpiresAt: expiresAt,
          billedStaffCount: 999,
        })
        .onConflictDoUpdate({
          target: attendanceSettings.tenantId,
          set: {
            subscriptionActive: true,
            subscriptionStartedAt: now,
            subscriptionExpiresAt: expiresAt,
            // Comp grant = effectively unlimited seats. Must reset on
            // the UPDATE path too — a pre-existing row left over from
            // a prior trial / mistaken activation would otherwise keep
            // its old billed_staff_count (often 0), making the
            // attendance slot guard reject every add-staff attempt.
            billedStaffCount: 999,
          },
        })
      modules.push('inventory', 'attendance', 'hpp')
    }
  } else if (input.moduleKey === 'inventory') {
    await exec
      .insert(inventorySettings)
      .values({
        tenantId: input.tenantId,
        tier: input.planKey,
        subscriptionActive: true,
        subscriptionStartedAt: now,
        subscriptionExpiresAt: expiresAt,
      })
      .onConflictDoUpdate({
        target: inventorySettings.tenantId,
        set: {
          tier: input.planKey,
          subscriptionActive: true,
          subscriptionStartedAt: now,
          subscriptionExpiresAt: expiresAt,
          updatedAt: now,
        },
      })
    modules.push('inventory')
  } else if (input.moduleKey === 'attendance') {
    await exec
      .insert(attendanceSettings)
      .values({
        tenantId: input.tenantId,
        subscriptionActive: true,
        subscriptionStartedAt: now,
        subscriptionExpiresAt: expiresAt,
        billedStaffCount: 999,
      })
      .onConflictDoUpdate({
        target: attendanceSettings.tenantId,
        set: {
          subscriptionActive: true,
          subscriptionStartedAt: now,
          subscriptionExpiresAt: expiresAt,
          // See the all-modules branch above — must reset on UPDATE
          // too so a leftover row with billed_staff_count = 0 doesn't
          // strand the comp grant.
          billedStaffCount: 999,
        },
      })
    modules.push('attendance')
  } else if (input.moduleKey === 'whatsapp') {
    await exec
      .insert(waSettings)
      .values({
        tenantId: input.tenantId,
        tier: input.planKey,
        subscriptionActive: true,
        subscriptionExpiresAt: expiresAt,
      })
      .onConflictDoUpdate({
        target: waSettings.tenantId,
        set: {
          tier: input.planKey,
          subscriptionActive: true,
          subscriptionExpiresAt: expiresAt,
          updatedAt: now,
        },
      })
    modules.push('whatsapp')
  }

  // Append the activated module(s) to tenants.active_modules.
  const [tenant] = await exec
    .select({ activeModules: tenants.activeModules })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1)
  const current = tenant?.activeModules ?? []
  const merged = Array.from(new Set([...current, ...modules]))
  if (merged.length !== current.length) {
    await exec
      .update(tenants)
      .set({ activeModules: merged, updatedAt: now })
      .where(eq(tenants.id, input.tenantId))
  }

  return expiresAt
}

// ─── Read ────────────────────────────────────────────────────────────

export const getCompContext = createServerFn().handler(async () => {
  const auth = await requirePlatformAdmin()
  return { isFounder: await isFounder(auth.userId) }
})

export const listCompGrants = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    return db
      .select()
      .from(compGrants)
      .where(eq(compGrants.tenantId, data.tenantId))
      .orderBy(desc(compGrants.createdAt))
  })

// ─── Create ──────────────────────────────────────────────────────────

const createSchema = z.object({
  tenantId: z.string().uuid(),
  durationMonths: z.coerce.number().int().min(1).max(60),
  reason: z.string().trim().min(1, 'Alasan wajib diisi').max(500),
  // One or more modules comped together in a single request.
  modules: z
    .array(
      z.object({
        moduleKey: z.enum(['pos', 'inventory', 'attendance', 'whatsapp']),
        planKey: z.string().trim().min(1).max(40),
      }),
    )
    .min(1, 'Pilih minimal 1 modul'),
})

export const createCompGrant = createServerFn({ method: 'POST' })
  .inputValidator(createSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()
    const founder = await isFounder(auth.userId)

    const [tenant] = await db
      .select({ id: tenants.id, name: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant tidak ditemukan.')

    // Non-founder admin → all requests wait for founder approval.
    if (!founder) {
      const rows = await db
        .insert(compGrants)
        .values(
          data.modules.map((m) => ({
            tenantId: data.tenantId,
            moduleKey: m.moduleKey,
            planKey: m.planKey,
            durationMonths: data.durationMonths,
            reason: data.reason,
            status: 'pending',
            requestedByUserId: auth.userId,
          })),
        )
        .returning({ id: compGrants.id })

      const founders = await db
        .select({ userId: platformAdmins.userId })
        .from(platformAdmins)
        .where(eq(platformAdmins.isFounder, true))
      for (const f of founders) {
        await createNotification({
          userId: f.userId,
          tenantId: data.tenantId,
          type: NOTIFICATION_TYPES.compRequestPending,
          title: 'Permintaan akses gratis',
          body: `Permintaan comp ${data.modules.length} modul untuk ${tenant.name} menunggu persetujuan Anda.`,
          url: `/admin/tenants/${data.tenantId}`,
          sourceKey: `comp-${rows[0]!.id}`,
        })
      }
      return { status: 'pending' as const, count: rows.length }
    }

    // Founder → apply every selected module immediately.
    await db.transaction(async (tx) => {
      const now = new Date()
      for (const m of data.modules) {
        const expiresAt = await applyCompGrant(tx as unknown as typeof db, {
          tenantId: data.tenantId,
          moduleKey: m.moduleKey,
          planKey: m.planKey,
          durationMonths: data.durationMonths,
        })
        await tx.insert(compGrants).values({
          tenantId: data.tenantId,
          moduleKey: m.moduleKey,
          planKey: m.planKey,
          durationMonths: data.durationMonths,
          reason: data.reason,
          status: 'applied',
          requestedByUserId: auth.userId,
          reviewedByUserId: auth.userId,
          reviewedAt: now,
          appliedAt: now,
          expiresAt,
        })
      }
    })
    return { status: 'applied' as const, count: data.modules.length }
  })

// ─── Review (founder only) ───────────────────────────────────────────

export const reviewCompGrant = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      action: z.enum(['approve', 'reject']),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()
    if (!(await isFounder(auth.userId))) {
      throw new Error('Hanya founder yang bisa menyetujui permintaan comp.')
    }
    const [grant] = await db
      .select()
      .from(compGrants)
      .where(eq(compGrants.id, data.id))
      .limit(1)
    if (!grant) throw new Error('Permintaan tidak ditemukan.')
    if (grant.status !== 'pending') {
      throw new Error('Permintaan ini sudah ditinjau.')
    }
    const now = new Date()

    if (data.action === 'reject') {
      await db
        .update(compGrants)
        .set({ status: 'rejected', reviewedByUserId: auth.userId, reviewedAt: now })
        .where(eq(compGrants.id, data.id))
      return { ok: true, status: 'rejected' as const }
    }

    await db.transaction(async (tx) => {
      const expiresAt = await applyCompGrant(tx as unknown as typeof db, {
        tenantId: grant.tenantId,
        moduleKey: grant.moduleKey,
        planKey: grant.planKey,
        durationMonths: grant.durationMonths,
      })
      await tx
        .update(compGrants)
        .set({
          status: 'applied',
          reviewedByUserId: auth.userId,
          reviewedAt: now,
          appliedAt: now,
          expiresAt,
        })
        .where(eq(compGrants.id, data.id))
    })
    return { ok: true, status: 'applied' as const }
  })
