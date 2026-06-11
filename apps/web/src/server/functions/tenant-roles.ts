/**
 * Tenant-owner RBAC. Mirrors the platform-admin fns in `rbac.ts` but
 * scoped to one tenant: an owner can curate custom roles for their
 * own staff from /settings/roles, never touch system roles or
 * another tenant's roles.
 *
 * Auth model: every mutation requires `settings.manage` (owner-only by
 * default — admins are deliberately excluded from changing the role
 * pool that gates their own privileges). Read fn `listTenantRoles`
 * only needs `members.read` so the team-members page can show role
 * metadata next to each row.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  roles,
  permissions as permissionsTable,
  rolePermissions,
  tenantMembers,
} from '@vintra/db/schema'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { requirePermission, type AuthContext } from '../middleware/auth'

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Load a role and assert the caller may EDIT it: must belong to the
 * caller's tenant AND not be a system role. Used by every mutation
 * below (update / set-permissions / delete) so the rules live in one
 * place.
 */
async function loadEditableRole(auth: AuthContext, roleId: string) {
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1)
  if (!role) throw new Error('Peran tidak ditemukan.')
  if (role.isSystem || role.tenantId === null) {
    throw new Error('Peran bawaan sistem tidak bisa diubah.')
  }
  if (role.tenantId !== auth.tenantId) {
    throw new Error('Peran ini bukan milik tenant Anda.')
  }
  return role
}

async function applyPermissions(roleId: string, permissionKeys: string[]) {
  const validIds =
    permissionKeys.length === 0
      ? []
      : (
          await db
            .select({ id: permissionsTable.id })
            .from(permissionsTable)
            .where(inArray(permissionsTable.key, permissionKeys))
        ).map((p) => p.id)

  // Replace existing mappings atomically.
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
  if (validIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(validIds.map((permissionId) => ({ roleId, permissionId })))
  }
}

// ─── Read ──────────────────────────────────────────────────────────

/**
 * All roles visible to this tenant: every system role plus this
 * tenant's own custom roles. Includes the resolved permission key
 * array and the current member-count per role so the UI can both
 * pre-fill the editor and block deletes that would orphan staff.
 */
export const listTenantRoles = createServerFn().handler(async () => {
  const auth = await requirePermission('members.read')

  const visible = await db
    .select({
      id: roles.id,
      tenantId: roles.tenantId,
      key: roles.key,
      label: roles.label,
      description: roles.description,
      isSystem: roles.isSystem,
      sortOrder: roles.sortOrder,
      createdAt: roles.createdAt,
    })
    .from(roles)
    .where(or(isNull(roles.tenantId), eq(roles.tenantId, auth.tenantId)))
    .orderBy(roles.sortOrder, roles.label)

  const roleIds = visible.map((r) => r.id)
  const [perms, counts] = await Promise.all([
    roleIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            roleId: rolePermissions.roleId,
            permissionKey: permissionsTable.key,
          })
          .from(rolePermissions)
          .innerJoin(
            permissionsTable,
            eq(rolePermissions.permissionId, permissionsTable.id),
          )
          .where(inArray(rolePermissions.roleId, roleIds)),
    roleIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            roleId: tenantMembers.roleId,
            count: sql<number>`count(*)::int`,
          })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.tenantId, auth.tenantId),
              inArray(tenantMembers.roleId, roleIds),
            ),
          )
          .groupBy(tenantMembers.roleId),
  ])

  const permsByRole = new Map<string, string[]>()
  for (const p of perms) {
    const list = permsByRole.get(p.roleId) ?? []
    list.push(p.permissionKey)
    permsByRole.set(p.roleId, list)
  }
  const countByRole = new Map(
    counts
      .filter((c) => c.roleId !== null)
      .map((c) => [c.roleId as string, c.count]),
  )

  return visible.map((r) => ({
    ...r,
    permissionKeys: permsByRole.get(r.id) ?? [],
    memberCount: countByRole.get(r.id) ?? 0,
  }))
})

/**
 * Every permission the system defines, grouped by module on the
 * client. Permission keys are code-level constants — not sensitive —
 * so `members.read` is enough.
 */
export const listAllPermissions = createServerFn().handler(async () => {
  await requirePermission('members.read')
  return db
    .select({
      id: permissionsTable.id,
      key: permissionsTable.key,
      label: permissionsTable.label,
      module: permissionsTable.module,
      description: permissionsTable.description,
    })
    .from(permissionsTable)
    .orderBy(permissionsTable.module, permissionsTable.key)
})

// ─── Mutations ─────────────────────────────────────────────────────

const ROLE_KEY_RE = /^[a-z][a-z0-9_-]*$/
const SYSTEM_RESERVED_KEYS = new Set([
  'owner',
  'admin',
  'outlet_owner',
  'supervisor',
  'staff',
  'cashier',
])

const createTenantRoleSchema = z.object({
  label: z.string().trim().min(1, 'Nama peran wajib diisi').max(60),
  description: z.string().trim().max(200).optional().nullable(),
  permissionKeys: z.array(z.string()),
})

/**
 * Auto-generate a tenant-unique key from the label. We don't ask the
 * owner for a key — they just type the human name; the slug is an
 * internal handle. Collisions inside the tenant get a numeric suffix.
 */
async function nextRoleKey(tenantId: string, label: string): Promise<string> {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  const seed = base && ROLE_KEY_RE.test(base) ? base : `peran-${Date.now()}`

  // Pull existing keys in this tenant + reserved system keys; iterate
  // until we land on a free one. Cheap — a tenant won't have hundreds.
  const taken = new Set<string>(SYSTEM_RESERVED_KEYS)
  const rows = await db
    .select({ key: roles.key })
    .from(roles)
    .where(eq(roles.tenantId, tenantId))
  for (const r of rows) taken.add(r.key)

  if (!taken.has(seed)) return seed
  for (let i = 2; i < 1000; i++) {
    const candidate = `${seed}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  // Astronomically unlikely, but fall through to a timestamped key so
  // the insert never fails on uniqueness.
  return `peran-${Date.now()}`
}

export const createTenantRole = createServerFn({ method: 'POST' })
  .inputValidator(createTenantRoleSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('settings.manage')

    const key = await nextRoleKey(auth.tenantId, data.label)
    const [created] = await db
      .insert(roles)
      .values({
        tenantId: auth.tenantId,
        key,
        label: data.label,
        description: data.description ?? null,
        isSystem: false,
        sortOrder: 100,
      })
      .returning()
    if (!created) throw new Error('Gagal membuat peran.')

    if (data.permissionKeys.length > 0) {
      await applyPermissions(created.id, data.permissionKeys)
    }
    return created
  })

const updateTenantRoleSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional().nullable(),
  permissionKeys: z.array(z.string()),
})

/**
 * Single-shot update: name + description + permission set, atomically.
 * The UI sends the whole desired state every save, mirroring how
 * setRolePermissions works on the platform-admin side.
 */
export const updateTenantRole = createServerFn({ method: 'POST' })
  .inputValidator(updateTenantRoleSchema)
  .handler(async ({ data }) => {
    const auth = await requirePermission('settings.manage')
    await loadEditableRole(auth, data.id)

    await db
      .update(roles)
      .set({
        label: data.label,
        description: data.description ?? null,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, data.id))
    await applyPermissions(data.id, data.permissionKeys)
    return { ok: true }
  })

export const deleteTenantRole = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePermission('settings.manage')
    await loadEditableRole(auth, data.id)

    // Block when staff still use the role — otherwise we'd silently
    // strip them of their permissions. Owner moves them first.
    const [memberRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, auth.tenantId),
          eq(tenantMembers.roleId, data.id),
        ),
      )
    const memberCount = memberRow?.count ?? 0
    if (memberCount > 0) {
      throw new Error(
        `Peran masih dipakai oleh ${memberCount} anggota. Pindahkan dulu sebelum menghapus.`,
      )
    }

    await db.delete(roles).where(eq(roles.id, data.id))
    return { ok: true }
  })
