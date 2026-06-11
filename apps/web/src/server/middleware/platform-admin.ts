import { db } from '@vintra/db'
import { platformAdmins } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, getOptionalAuth, type AuthContext } from './auth'

export interface PlatformAdminContext extends AuthContext {
  isPlatformAdmin: true
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const auth = await requireAuth()
  const [admin] = await db
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, auth.userId))
    .limit(1)

  if (!admin) {
    throw new Error('Forbidden')
  }

  return { ...auth, isPlatformAdmin: true }
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1)
  return !!row
}

export async function getPlatformAdminFlag(): Promise<boolean> {
  const auth = await getOptionalAuth()
  if (!auth) return false
  return isPlatformAdmin(auth.userId)
}
