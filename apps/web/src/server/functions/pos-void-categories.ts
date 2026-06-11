/**
 * Tenant-configurable void categories (JUR-204).
 *
 * Owner picks reasons from this list when cancelling a POS sale; the
 * report breakdown ("most voids were Ganti metode bayar") groups by
 * the same id. Five system defaults are seeded lazily per-tenant on
 * the first list call so brand-new tenants get a usable dropdown
 * without an owner-facing setup step.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { posVoidCategories } from '@vintra/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { requirePOSAccess } from '../middleware/module-access'

const SYSTEM_DEFAULTS: ReadonlyArray<{ label: string; sortOrder: number }> = [
  { label: 'Ganti metode bayar', sortOrder: 10 },
  { label: 'Salah input', sortOrder: 20 },
  { label: 'Pelanggan batal', sortOrder: 30 },
  { label: 'Item tidak tersedia', sortOrder: 40 },
  { label: 'Lainnya', sortOrder: 50 },
]

/**
 * Idempotently seed the system defaults the first time any caller
 * reads the list for this tenant. Race-tolerant: a concurrent second
 * call seeing zero rows would try to insert again, but the windows
 * are tiny and the worst case (5 duplicate rows) is harmless — the
 * owner can archive the extras from the settings page.
 */
async function ensureSeeded(tenantId: string): Promise<void> {
  const [existing] = await db
    .select({ id: posVoidCategories.id })
    .from(posVoidCategories)
    .where(eq(posVoidCategories.tenantId, tenantId))
    .limit(1)
  if (existing) return
  await db.insert(posVoidCategories).values(
    SYSTEM_DEFAULTS.map((d) => ({
      tenantId,
      label: d.label,
      sortOrder: d.sortOrder,
      isSystem: true,
    })),
  )
}

/**
 * List active void categories for this tenant. The cashier-facing
 * void modal calls this on open; the settings page also calls it but
 * with includeArchived=true to show the manage screen.
 */
export const listVoidCategories = createServerFn({ method: 'POST' })
  .inputValidator(
    z
      .object({
        includeArchived: z.boolean().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    await ensureSeeded(auth.tenantId)

    const rows = await db
      .select({
        id: posVoidCategories.id,
        label: posVoidCategories.label,
        sortOrder: posVoidCategories.sortOrder,
        isSystem: posVoidCategories.isSystem,
        isActive: posVoidCategories.isActive,
      })
      .from(posVoidCategories)
      .where(eq(posVoidCategories.tenantId, auth.tenantId))
      .orderBy(asc(posVoidCategories.sortOrder), asc(posVoidCategories.label))

    const includeArchived = data?.includeArchived ?? false
    return includeArchived ? rows : rows.filter((r) => r.isActive)
  })

const labelSchema = z
  .string()
  .trim()
  .min(1, 'Nama kategori wajib diisi')
  .max(60, 'Nama kategori terlalu panjang')

export const createVoidCategory = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      label: labelSchema,
      sortOrder: z.number().int().min(0).max(10_000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    if (!auth.permissions.includes('pos.manage')) {
      throw new Error('Hanya pemilik / admin yang bisa kelola kategori.')
    }
    const [row] = await db
      .insert(posVoidCategories)
      .values({
        tenantId: auth.tenantId,
        label: data.label,
        sortOrder: data.sortOrder ?? 1000,
        isSystem: false,
        isActive: true,
      })
      .returning({
        id: posVoidCategories.id,
        label: posVoidCategories.label,
      })
    return row!
  })

export const updateVoidCategory = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      label: labelSchema.optional(),
      sortOrder: z.number().int().min(0).max(10_000).optional(),
      isActive: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    if (!auth.permissions.includes('pos.manage')) {
      throw new Error('Hanya pemilik / admin yang bisa kelola kategori.')
    }
    const [row] = await db
      .select({
        id: posVoidCategories.id,
        isSystem: posVoidCategories.isSystem,
      })
      .from(posVoidCategories)
      .where(
        and(
          eq(posVoidCategories.id, data.id),
          eq(posVoidCategories.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Kategori tidak ditemukan')
    // System rows: protect the label from drift so the reports
    // breakdown semantics stay consistent across tenants. Owner can
    // still reorder + archive them.
    const patch: Partial<{
      label: string
      sortOrder: number
      isActive: boolean
      updatedAt: Date
    }> = { updatedAt: new Date() }
    if (data.label != null && !row.isSystem) patch.label = data.label
    if (data.sortOrder != null) patch.sortOrder = data.sortOrder
    if (data.isActive != null) patch.isActive = data.isActive

    await db
      .update(posVoidCategories)
      .set(patch)
      .where(eq(posVoidCategories.id, data.id))
    return { ok: true as const }
  })
