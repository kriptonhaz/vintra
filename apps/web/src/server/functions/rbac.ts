import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  roles,
  permissions as permissionsTable,
  rolePermissions,
  tenantMembers,
} from '@vintra/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requirePlatformAdmin } from '../middleware/platform-admin'

// ─── Listing ────────────────────────────────────────

export const listRoles = createServerFn().handler(async () => {
  await requirePlatformAdmin()

  const allRoles = await db.select().from(roles).orderBy(roles.sortOrder, roles.label)
  const allMappings = await db
    .select({
      roleId: rolePermissions.roleId,
      permissionKey: permissionsTable.key,
    })
    .from(rolePermissions)
    .innerJoin(
      permissionsTable,
      eq(rolePermissions.permissionId, permissionsTable.id),
    )

  const permsByRole = new Map<string, string[]>()
  for (const m of allMappings) {
    const list = permsByRole.get(m.roleId) ?? []
    list.push(m.permissionKey)
    permsByRole.set(m.roleId, list)
  }

  // Member counts per role (so admins know who's assigned what)
  const memberCounts = await db
    .select({
      roleId: tenantMembers.roleId,
      count: sql<number>`count(*)::int`,
    })
    .from(tenantMembers)
    .groupBy(tenantMembers.roleId)
  const countByRole = new Map(
    memberCounts
      .filter((c) => c.roleId !== null)
      .map((c) => [c.roleId as string, c.count]),
  )

  return allRoles.map((r) => ({
    ...r,
    permissionKeys: permsByRole.get(r.id) ?? [],
    memberCount: countByRole.get(r.id) ?? 0,
  }))
})

export const listPermissions = createServerFn().handler(async () => {
  await requirePlatformAdmin()
  return db
    .select()
    .from(permissionsTable)
    .orderBy(permissionsTable.module, permissionsTable.key)
})

// ─── Mutations ──────────────────────────────────────

const createRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/, 'Gunakan huruf kecil, angka, "-" atau "_"'),
  label: z.string().min(1, 'Label wajib diisi'),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).default(100),
  permissionKeys: z.array(z.string()).default([]),
})

export const createRole = createServerFn({ method: 'POST' })
  .inputValidator(createRoleSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const existing = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, data.key))
      .limit(1)
    if (existing.length > 0) {
      throw new Error('Role dengan key tersebut sudah ada')
    }

    const [created] = await db
      .insert(roles)
      .values({
        key: data.key,
        label: data.label,
        description: data.description ?? null,
        sortOrder: data.sortOrder,
        isSystem: false,
      })
      .returning()

    if (data.permissionKeys.length > 0 && created) {
      await applyPermissions(created.id, data.permissionKeys)
    }

    return created
  })

const updateRoleSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export const updateRole = createServerFn({ method: 'POST' })
  .inputValidator(updateRoleSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const { id, ...updates } = data
    const [updated] = await db
      .update(roles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning()

    if (!updated) throw new Error('Role tidak ditemukan')
    return updated
  })

const setRolePermissionsSchema = z.object({
  roleId: z.string().uuid(),
  permissionKeys: z.array(z.string()),
})

export const setRolePermissions = createServerFn({ method: 'POST' })
  .inputValidator(setRolePermissionsSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, data.roleId))
      .limit(1)
    if (!role) throw new Error('Role tidak ditemukan')

    if (role.key === 'owner') {
      throw new Error('Permission untuk role pemilik tidak dapat diubah')
    }

    await applyPermissions(data.roleId, data.permissionKeys)
    return { success: true }
  })

export const deleteRole = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.id, data.id))
      .limit(1)
    if (!role) throw new Error('Role tidak ditemukan')
    if (role.isSystem) throw new Error('Role bawaan sistem tidak dapat dihapus')

    const [memberCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenantMembers)
      .where(eq(tenantMembers.roleId, data.id))
    const memberCount = memberCountRow?.count ?? 0
    if (memberCount > 0) {
      throw new Error(
        `Role masih digunakan oleh ${memberCount} anggota. Pindahkan dulu sebelum menghapus.`,
      )
    }

    await db.delete(roles).where(eq(roles.id, data.id))
    return { success: true }
  })

// ─── Helpers ────────────────────────────────────────

async function applyPermissions(roleId: string, permissionKeys: string[]) {
  // Resolve permission IDs from keys
  const ids =
    permissionKeys.length === 0
      ? []
      : await db
          .select({ id: permissionsTable.id, key: permissionsTable.key })
          .from(permissionsTable)
          .where(inArray(permissionsTable.key, permissionKeys))

  const validIds = ids.map((p) => p.id)

  // Replace existing mappings atomically (delete + insert)
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
  if (validIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(validIds.map((permissionId) => ({ roleId, permissionId })))
  }
}
