/**
 * Push HPP costs onto `inventory_items.cost_price`.
 *
 * The HPP module owns what an item COSTS. Two separate paths feed it:
 *
 *   - a raw ingredient item mirrors `materials.price_per_unit`
 *   - a recipe-backed item mirrors its HPP product's computed `hpp`
 *
 * Only the first path had any sync at all, and only as an opt-in
 * banner (`applyHppPriceToInventory`) the owner had to notice and
 * press. A recipe-backed item's cost was copied once at import time
 * and then frozen forever: raise the price of gula and every recipe's
 * HPP moves, while the POS catalog keeps showing "Modal Rp <old>"
 * indefinitely — the number an owner reads when deciding what to
 * charge. That is the drift this module removes.
 *
 * ── What is NOT affected ─────────────────────────────────────────────
 *
 * Profit on a recorded sale was always correct — the sale path reads
 * the live `products.hpp` for recipe-linked lines rather than the
 * item's stored cost. This fixes the numbers an OWNER reads (the item
 * list, its margin pill, PO valuations), not the books.
 *
 * ── The toggle ───────────────────────────────────────────────────────
 *
 * Every write here respects the per-item `auto_sync_hpp_cost` flag.
 * Before this module the flag only governed material-linked items; it
 * now governs recipe-linked items too, which is what makes an escape
 * hatch exist for a tenant whose item cost legitimately comes from
 * somewhere else.
 *
 * ── Direction ────────────────────────────────────────────────────────
 *
 * One-way, HPP → inventory, exactly as `pos-price-sync.ts` already is
 * for the selling price. Two editable fields syncing both ways always
 * needs a tie-breaker and always eventually drifts.
 */
import { db } from '@vintra/db'
import { inventoryItems, materials, products } from '@vintra/db/schema'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { DbExecutor } from './hpp-cascade'

export interface CostSyncResult {
  updated: Array<{
    itemId: string
    itemName: string
    oldCost: number
    newCost: number
  }>
}

const EMPTY: CostSyncResult = { updated: [] }

/**
 * Bring recipe-linked items' cost in line with their HPP product's
 * computed `hpp`.
 *
 * SCOPED TO `productIds` when given — a cascade knows exactly which
 * products moved, and re-stamping the rest would rewrite `updated_at`
 * on items nothing happened to. Pass no ids to sweep the whole tenant;
 * that form is for the explicit, owner-initiated "perbarui dari HPP"
 * action, never for an incidental save.
 */
export async function syncInventoryCostFromProducts(
  tenantId: string,
  executor: DbExecutor = db,
  productIds?: readonly string[],
): Promise<CostSyncResult> {
  if (productIds != null && productIds.length === 0) return EMPTY

  const rows = await executor
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      currentCost: inventoryItems.costPrice,
      targetCost: products.hpp,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(products.id, inventoryItems.linkedHppProductId))
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isActive, true),
        eq(inventoryItems.autoSyncHppCost, true),
        isNotNull(inventoryItems.linkedHppProductId),
        ...(productIds != null
          ? [inArray(inventoryItems.linkedHppProductId, [...productIds])]
          : []),
      ),
    )

  return applyCostUpdates(executor, rows)
}

/**
 * Bring ingredient items' cost in line with their HPP material's
 * `pricePerUnit`. Same contract as the product variant above.
 *
 * This overlaps with `applyHppPriceToInventory`, which stays as the
 * one-material affordance behind the price-change banner. This one
 * exists so the bulk screen can refresh many materials in a single
 * call.
 */
export async function syncInventoryCostFromMaterials(
  tenantId: string,
  executor: DbExecutor = db,
  materialIds?: readonly string[],
): Promise<CostSyncResult> {
  if (materialIds != null && materialIds.length === 0) return EMPTY

  const rows = await executor
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      currentCost: inventoryItems.costPrice,
      targetCost: materials.pricePerUnit,
    })
    .from(inventoryItems)
    .innerJoin(materials, eq(materials.id, inventoryItems.linkedHppMaterialId))
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isActive, true),
        eq(inventoryItems.autoSyncHppCost, true),
        isNotNull(inventoryItems.linkedHppMaterialId),
        ...(materialIds != null
          ? [inArray(inventoryItems.linkedHppMaterialId, [...materialIds])]
          : []),
      ),
    )

  return applyCostUpdates(executor, rows)
}

export interface CostSyncCandidate {
  itemId: string
  itemName: string
  currentCost: string
  targetCost: string | null
}

/**
 * Decide which items move and to what — the whole judgement of this
 * module, kept free of the database so it can be tested directly. This
 * code overwrites a stored money value, so "which rows does it touch"
 * deserves to be pinned down by tests rather than inferred from the
 * query.
 *
 * Returns the per-item changes plus the same set grouped by target
 * value, so a cascade off a common ingredient — which lands the same
 * cost on many items — costs one UPDATE per distinct price rather than
 * one per item.
 */
export function planCostUpdates(rows: readonly CostSyncCandidate[]): {
  updated: CostSyncResult['updated']
  byTarget: Map<string, string[]>
} {
  const updated: CostSyncResult['updated'] = []
  const byTarget = new Map<string, string[]>()

  for (const row of rows) {
    // A product with no computed HPP yet (empty recipe, or one sitting
    // in a cycle the engine refused to resolve) has nothing to say
    // about cost. Leave whatever the owner set.
    if (row.targetCost == null) continue
    const target = Number(row.targetCost)
    if (!Number.isFinite(target)) continue
    const current = Number(row.currentCost)
    if (current === target) continue

    const key = target.toFixed(2)
    const bucket = byTarget.get(key)
    if (bucket) bucket.push(row.itemId)
    else byTarget.set(key, [row.itemId])

    updated.push({
      itemId: row.itemId,
      itemName: row.itemName,
      oldCost: current,
      newCost: target,
    })
  }

  return { updated, byTarget }
}

/** Persist what `planCostUpdates` decided. */
async function applyCostUpdates(
  executor: DbExecutor,
  rows: readonly CostSyncCandidate[],
): Promise<CostSyncResult> {
  const { updated, byTarget } = planCostUpdates(rows)
  if (updated.length === 0) return EMPTY

  const now = new Date()
  for (const [costPrice, itemIds] of byTarget) {
    await executor
      .update(inventoryItems)
      .set({ costPrice, updatedAt: now })
      .where(inArray(inventoryItems.id, itemIds))
  }

  return { updated }
}
