/**
 * Cascade an ingredient or recipe change through every affected product.
 *
 * `products.hpp` is derived data: it is only ever the sum of what the recipe
 * costs at today's ingredient prices. Letting it drift from that is not a
 * missing feature, it is wrong data — an owner prices a menu against a cost
 * that no longer exists.
 *
 * TRANSACTION DISCIPLINE IS THE POINT. Every caller passes its own `tx`, so
 * the recalculation commits atomically with the change that triggered it. A
 * cascade reading through the root client instead would see the price as it
 * was BEFORE the enclosing transaction's update, silently recompute from the
 * old number, and write a confidently wrong result. That is why
 * `DbExecutor` is threaded all the way down rather than defaulted at the
 * bottom.
 */
import { db } from '@vintra/db'
import { products, productMaterials, materials, hppPriceHistory } from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'
import { computeHpp, type HppComputeResult } from './hpp-engine'
import { syncInventoryCostFromProducts } from './hpp-cost-sync'

/** Root client, or an open transaction. */
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Why a cascade ran. Recorded on every history row. */
export type RecalcReason = 'material_price' | 'stock_in' | 'recipe' | 'manual'

export interface RecalcContext {
  reason: RecalcReason
  /** The ingredient whose price triggered this, when there was one. */
  materialId?: string | null
}

export interface RecalcResult {
  /** Products whose stored HPP actually moved. */
  changed: Array<{
    productId: string
    oldHpp: number | null
    newHpp: number
    oldMargin: number | null
    newMargin: number
  }>
  /** Recomputed but unchanged — counted, not listed. */
  unchanged: number
  /** Left alone because they sit in a recipe cycle. */
  unresolved: string[]
  maxDepth: number
  /**
   * How many inventory items had their `cost_price` follow the products
   * above. Only recipe-linked items with `auto_sync_hpp_cost` on move —
   * see `hpp-cost-sync.ts`.
   */
  costSyncedItems: number
}

/**
 * Load a tenant's recipe graph through the given executor and compute every
 * product's HPP.
 *
 * Three queries regardless of catalog size, so a cascade never degrades into
 * per-product round trips.
 */
export async function computeTenantHppWith(
  tenantId: string,
  exec: DbExecutor,
  /**
   * Hypothetical prices to substitute for the stored ones, keyed by material
   * id. Used to answer "what would this price change do?" without writing
   * anything — the preview a manual edit shows before the owner commits to it.
   */
  priceOverrides?: ReadonlyMap<string, number>,
): Promise<HppComputeResult> {
  const [productRows, bomRows, materialRows] = await Promise.all([
    exec
      .select({
        id: products.id,
        sellingPrice: products.sellingPrice,
        productionQty: products.productionQty,
      })
      .from(products)
      .where(eq(products.tenantId, tenantId)),
    exec
      .select({
        productId: productMaterials.productId,
        materialId: productMaterials.materialId,
        sourceProductId: productMaterials.sourceProductId,
        quantity: productMaterials.quantity,
      })
      .from(productMaterials)
      .where(eq(productMaterials.tenantId, tenantId)),
    exec
      .select({ id: materials.id, pricePerUnit: materials.pricePerUnit })
      .from(materials)
      .where(eq(materials.tenantId, tenantId)),
  ])

  return computeHpp(
    productRows.map((p) => ({
      id: p.id,
      sellingPrice: Number(p.sellingPrice ?? 0),
      productionQty: p.productionQty == null ? null : Number(p.productionQty),
    })),
    bomRows.map((b) => ({
      productId: b.productId,
      materialId: b.materialId,
      sourceProductId: b.sourceProductId,
      quantity: Number(b.quantity ?? 0),
    })),
    new Map(
      materialRows.map((m) => [
        m.id,
        priceOverrides?.get(m.id) ?? Number(m.pricePerUnit ?? 0),
      ]),
    ),
  )
}

/** Storage precision of `products.hpp` — compare at the same resolution. */
function sameMoney(a: number | null, b: number): boolean {
  if (a == null) return false
  return Math.round(a * 100) === Math.round(b * 100)
}

/**
 * What would happen if this ingredient's price became `newPrice`?
 *
 * Read-only: computes the graph twice — once as stored, once with the price
 * substituted — and diffs them. Nothing is written, so this is safe to call
 * on every keystroke of a price field if the UI wants to.
 *
 * The owner is shown this BEFORE a manual price edit is applied, because a
 * price change they typed is a decision with consequences they can act on:
 * which products moved, by how much, and — the part actually worth deciding
 * about — which ones now sell below a healthy margin.
 */
export async function previewMaterialPriceChange(
  tenantId: string,
  materialId: string,
  newPrice: number,
  exec: DbExecutor = db,
): Promise<CostChangeImpact & { products: RecalcResult['changed'] }> {
  const [current, hypothetical] = await Promise.all([
    computeTenantHppWith(tenantId, exec),
    computeTenantHppWith(tenantId, exec, new Map([[materialId, newPrice]])),
  ])

  const changed: RecalcResult['changed'] = []
  let unchanged = 0

  for (const [productId, after] of hypothetical.values) {
    const before = current.values.get(productId)
    if (before && sameMoney(before.hpp, after.hpp)) {
      unchanged++
      continue
    }
    changed.push({
      productId,
      oldHpp: before?.hpp ?? null,
      newHpp: after.hpp,
      oldMargin: before?.margin ?? null,
      newMargin: after.margin,
    })
  }

  const result: RecalcResult = {
    changed,
    unchanged,
    unresolved: hypothetical.unresolved,
    maxDepth: hypothetical.maxDepth,
    // A preview writes nothing, so nothing has followed it into the
    // item list. The real number lands when the edit is saved.
    costSyncedItems: 0,
  }
  return { ...summarizeImpact(result), products: changed }
}

/**
 * Recompute the tenant's whole catalog and persist only what moved.
 *
 * Writing only changed rows matters for more than efficiency: it keeps
 * `hpp_price_history` a record of actual movements rather than a log of every
 * time somebody saved a form, and it leaves `updatedAt` meaningful.
 *
 * Products inside a recipe cycle are left exactly as they were and reported
 * instead. A stale number is recoverable; a guessed one silently prices a
 * menu.
 */
export async function recalcTenantHpp(
  tenantId: string,
  exec: DbExecutor,
  ctx: RecalcContext,
): Promise<RecalcResult> {
  const graph = await computeTenantHppWith(tenantId, exec)

  const stored = await exec
    .select({ id: products.id, hpp: products.hpp, margin: products.margin })
    .from(products)
    .where(eq(products.tenantId, tenantId))

  const storedById = new Map(
    stored.map((p) => [
      p.id,
      {
        hpp: p.hpp == null ? null : Number(p.hpp),
        margin: p.margin == null ? null : Number(p.margin),
      },
    ]),
  )

  const changed: RecalcResult['changed'] = []
  let unchanged = 0

  for (const [productId, computed] of graph.values) {
    const before = storedById.get(productId)
    if (before && sameMoney(before.hpp, computed.hpp)) {
      unchanged++
      continue
    }

    await exec
      .update(products)
      .set({
        hpp: computed.hpp.toFixed(2),
        margin: computed.margin.toFixed(2),
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))

    changed.push({
      productId,
      oldHpp: before?.hpp ?? null,
      newHpp: computed.hpp,
      oldMargin: before?.margin ?? null,
      newMargin: computed.margin,
    })
  }

  if (changed.length > 0) {
    // One statement for the whole batch — a cascade off a common ingredient
    // can touch dozens of products, and this runs inside the caller's
    // transaction.
    await exec.insert(hppPriceHistory).values(
      changed.map((c) => ({
        tenantId,
        productId: c.productId,
        oldHpp: c.oldHpp == null ? null : c.oldHpp.toFixed(2),
        newHpp: c.newHpp.toFixed(2),
        reason: ctx.reason,
        triggeredByMaterialId: ctx.materialId ?? null,
      })),
    )
  }

  // The item list's "Modal" follows the recipe cost we just wrote. Same
  // transaction and the same reasoning as the history rows above: an HPP
  // move that committed without reaching the item list is precisely the
  // drift this cascade exists to remove. Scoped to the products that
  // actually moved, so items nothing happened to keep their updated_at.
  const costSync =
    changed.length > 0
      ? await syncInventoryCostFromProducts(
          tenantId,
          exec,
          changed.map((c) => c.productId),
        )
      : { updated: [] }

  return {
    changed,
    unchanged,
    unresolved: graph.unresolved,
    maxDepth: graph.maxDepth,
    costSyncedItems: costSync.updated.length,
  }
}

/** A product's margin dropping below this is worth telling the owner about. */
export const DANGER_MARGIN = 20

export interface CostChangeImpact {
  affected: number
  unchanged: number
  unresolved: number
  /** Average movement in rupiah across affected products. */
  averageMove: number
  /** Products whose margin would land under DANGER_MARGIN. */
  belowDanger: Array<{ productId: string; margin: number }>
}

/** Summarise a recalculation for a confirmation dialog. */
export function summarizeImpact(result: RecalcResult): CostChangeImpact {
  const moves = result.changed.map((c) => c.newHpp - (c.oldHpp ?? 0))
  const averageMove =
    moves.length === 0 ? 0 : moves.reduce((a, b) => a + b, 0) / moves.length

  return {
    affected: result.changed.length,
    unchanged: result.unchanged,
    unresolved: result.unresolved.length,
    averageMove,
    belowDanger: result.changed
      .filter((c) => c.newMargin < DANGER_MARGIN)
      .map((c) => ({ productId: c.productId, margin: c.newMargin })),
  }
}
