/**
 * Server functions for the platform-admin RAG tool definitions page.
 *
 * CRUD lives here (TanStack + Drizzle, requirePlatformAdmin) — same
 * pattern as admin-wa-plans.ts. The preview action calls the Go api's
 * /v1/internal/rag/preview endpoint with X-Internal-Service-Token,
 * since retrieval logic lives in Go where the worker also runs it.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { waRagTools } from '@vintra/db/schema'
import { asc, desc, eq, gt, lt } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type RagTool = typeof waRagTools.$inferSelect

const RETRIEVAL_TYPES = [
  'inventory_price',
  'inventory_stock',
  'store_address',
  'operating_hours',
  'payment_methods',
  'promotions',
  'loyalty_points',
  'loyalty_stamps',
  'order_history',
  'recipe_availability',
  'online_orders_status',
] as const
const TIERS = ['basic', 'komplit', 'enterprise'] as const
const TRIGGER_MODES = ['always', 'on_keyword', 'on_customer_match'] as const

const upsertSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable(),
  retrievalType: z.enum(RETRIEVAL_TYPES),
  minTier: z.enum(TIERS),
  triggerMode: z.enum(TRIGGER_MODES),
  triggerKeywords: z.array(z.string().min(1).max(40)).max(30),
  isActive: z.boolean(),
})

export const listRagTools = createServerFn({ method: 'POST' }).handler(async () => {
  await requirePlatformAdmin()
  return db.select().from(waRagTools).orderBy(asc(waRagTools.sortOrder))
})

export const createRagTool = createServerFn({ method: 'POST' })
  .inputValidator(upsertSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    // Append to the bottom — pick max(sort_order) + 10 so manual edits
    // can still squeeze new entries between existing ones.
    const existing = await db
      .select({ sortOrder: waRagTools.sortOrder })
      .from(waRagTools)
      .orderBy(asc(waRagTools.sortOrder))
    const nextOrder = existing.length > 0 ? Math.max(...existing.map((r) => r.sortOrder)) + 10 : 10
    const [row] = await db
      .insert(waRagTools)
      .values({ ...data, sortOrder: nextOrder })
      .returning()
    return row
  })

export const updateRagTool = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }).merge(upsertSchema))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const { id, ...patch } = data
    const [row] = await db
      .update(waRagTools)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(waRagTools.id, id))
      .returning()
    return row
  })

export const deleteRagTool = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    // FK ON DELETE CASCADE on wa_instance_rag_tools handles tenant rows.
    await db.delete(waRagTools).where(eq(waRagTools.id, data.id))
    return { ok: true }
  })

export const moveRagTool = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid(), direction: z.enum(['up', 'down']) }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [current] = await db
      .select()
      .from(waRagTools)
      .where(eq(waRagTools.id, data.id))
    if (!current) throw new Error('Tool not found')

    // Find adjacent row (closest lower sort_order for "up", closest higher for "down").
    const [neighbour] =
      data.direction === 'up'
        ? await db
            .select()
            .from(waRagTools)
            .where(lt(waRagTools.sortOrder, current.sortOrder))
            .orderBy(desc(waRagTools.sortOrder))
            .limit(1)
        : await db
            .select()
            .from(waRagTools)
            .where(gt(waRagTools.sortOrder, current.sortOrder))
            .orderBy(asc(waRagTools.sortOrder))
            .limit(1)

    // No neighbour = at the boundary. Per plan: no-op, return current state.
    if (!neighbour) return { ok: true, swapped: false }

    // Two-row swap inside a transaction.
    await db.transaction(async (tx) => {
      // Park current at -1 to dodge the unlikely-but-possible case of a
      // unique constraint on sort_order being added later.
      await tx.update(waRagTools).set({ sortOrder: -1 }).where(eq(waRagTools.id, current.id))
      await tx
        .update(waRagTools)
        .set({ sortOrder: current.sortOrder })
        .where(eq(waRagTools.id, neighbour.id))
      await tx
        .update(waRagTools)
        .set({ sortOrder: neighbour.sortOrder })
        .where(eq(waRagTools.id, current.id))
    })
    return { ok: true, swapped: true }
  })

export type RagPreviewResponse = {
  snippets: Array<{ toolId: string; source: string; text: string; latencyMs: number }>
  rawRows: Array<{
    toolId: string
    toolName: string
    // Narrow to `unknown` would be safer, but the TanStack server-fn
    // serializer infers returned objects as { [k: string]: {} }, and
    // `unknown` doesn't satisfy that. `any` here is intentional — raw
    // rows are arbitrary debug data the admin sees as JSON.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: Array<Record<string, any>>
    latencyMs: number
  }>
  totalMs: number
  estimatedTokens: number
}

export const previewRagTools = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tenantId: z.string().uuid(),
      message: z.string().min(1).max(2000),
      remoteJid: z.string().max(120).optional(),
    }),
  )
  .handler(async ({ data }): Promise<RagPreviewResponse> => {
    await requirePlatformAdmin()
    const apiBase = process.env['API_URL'] ?? 'http://localhost:4000'
    const token = process.env['INTERNAL_SERVICE_TOKEN']
    if (!token) {
      throw new Error('INTERNAL_SERVICE_TOKEN tidak dikonfigurasi di apps/web .env')
    }
    const res = await fetch(`${apiBase}/v1/internal/rag/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`RAG preview gagal (${res.status}): ${text}`)
    }
    return (await res.json()) as RagPreviewResponse
  })

// Helper for the tenant picker — list lightweight tenant rows for the
// preview dropdown. Avoid hitting admin-tenants which is paginated.
import { tenants } from '@vintra/db/schema'
export const listTenantsForRagPreview = createServerFn({ method: 'POST' }).handler(async () => {
  await requirePlatformAdmin()
  return db
    .select({ id: tenants.id, businessName: tenants.businessName })
    .from(tenants)
    .orderBy(asc(tenants.businessName))
})
