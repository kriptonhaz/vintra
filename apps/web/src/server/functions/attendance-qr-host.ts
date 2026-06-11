import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  branches,
  qrHostSessions,
  attendanceSettings,
} from '@vintra/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { requireActiveModule } from '../middleware/module-access'
import { requirePermission } from '../middleware/auth'
import { generateQrToken } from '@/lib/attendance-qr'

const MODULE_KEY = 'attendance'

async function requireHost() {
  await requireActiveModule(MODULE_KEY)
  return requirePermission('attendance.manage')
}

export const startQrHost = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireHost()

    const [branch] = await db
      .select()
      .from(branches)
      .where(
        and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan.')

    await db
      .insert(qrHostSessions)
      .values({
        tenantId: auth.tenantId,
        branchId: branch.id,
        hostUserId: auth.userId,
      })
      .onConflictDoUpdate({
        target: qrHostSessions.hostUserId,
        set: {
          tenantId: auth.tenantId,
          branchId: branch.id,
          lastTokenIssuedAt: new Date(),
          updatedAt: new Date(),
        },
      })

    return { branchId: branch.id, branchName: branch.name }
  })

/**
 * Issues a fresh QR token for the caller's active host session.
 * Called on a short interval by the host page to keep the displayed QR fresh.
 */
export const rotateQrToken = createServerFn({ method: 'POST' }).handler(
  async () => {
    const auth = await requireHost()

    const [session] = await db
      .select()
      .from(qrHostSessions)
      .where(eq(qrHostSessions.hostUserId, auth.userId))
      .limit(1)
    if (!session) {
      throw new Error('Sesi host belum aktif. Mulai dulu dari tombol Mulai.')
    }

    const [settings] = await db
      .select({ qrRotationSeconds: attendanceSettings.qrRotationSeconds })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, auth.tenantId))
      .limit(1)

    const ttl = settings?.qrRotationSeconds ?? 30

    const result = generateQrToken({
      tenantId: auth.tenantId,
      branchId: session.branchId,
      hostUserId: auth.userId,
      ttlSeconds: ttl,
    })

    await db
      .update(qrHostSessions)
      .set({ lastTokenIssuedAt: new Date(), updatedAt: new Date() })
      .where(eq(qrHostSessions.hostUserId, auth.userId))

    return {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      rotationSeconds: ttl,
    }
  },
)

export const stopQrHost = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireHost()
  await db
    .delete(qrHostSessions)
    .where(eq(qrHostSessions.hostUserId, auth.userId))
  return { success: true }
})
