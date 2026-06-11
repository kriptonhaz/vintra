/**
 * Walk a recipe-backed product's BOM and deduct each material's stock
 * from the matching ingredient inventory item.
 *
 * Extracted from `pos.ts` for JUR-15 so the prep-batch flow can reuse
 * the same deduction logic: a "Prep batch" action triggers exactly the
 * same BOM walk as a sale would have triggered, just at prep time
 * instead of sale time.
 *
 * Per-BOM-row logic:
 *   - Material rows (`materialId IS NOT NULL`): look up the inventory
 *     item linked via `linkedHppMaterialId`. If found, convert the
 *     recipe's per-base-unit quantity to the inventory base unit (via
 *     `inventory_item_units.ratioToBase` when the units differ), insert
 *     a stock-out movement, and update the balance. If not found,
 *     track for the unlinked-material notification (caller emits it
 *     once per material).
 *   - Sub-product rows (`sourceProductId IS NOT NULL`): recurse into
 *     the sub-product's own BOM, scaling the consumed quantity by the
 *     sub-product's production batch size. A sub-product that can't be
 *     scaled (no `productionQty`, or a recipe unit that doesn't match
 *     its `productionUnit`) is skipped + tracked for a notification —
 *     the sale is never blocked over a recipe-config gap. Recursion is
 *     cycle-guarded (ancestor set) and depth-capped.
 *
 * Hard errors (whole tx rolls back):
 *   - Recipe unit doesn't match the ingredient's base AND no
 *     `inventory_item_units` row for the (ingredient, recipeUnit) pair
 */
import { db } from '@vintra/db'
import {
  inventoryItems,
  inventoryItemUnits,
  inventoryStockBalances,
  inventoryMovements,
  productMaterials,
  products,
  materials,
  masterHppUnits,
} from '@vintra/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * `tx` is intentionally typed as the same shape as the root db client.
 * Drizzle transactions and the root client share an interface; passing
 * `db` directly works for non-transactional callers (we currently always
 * call this from inside a transaction, so the behavior is the same).
 */
export interface DeductBomArgs {
  tx: typeof db
  tenantId: string
  userId: string
  branchId: string
  parentLinkedHppProductId: string
  /** How much of the parent product (in its inventory base unit) was sold or prepped. */
  parentBaseQty: number
  /**
   * Movement reason chip. POS sale path uses 'pos_sale_ingredient'; the
   * prep-batch path uses 'prep_batch'. Surfaces in stock movement
   * reports so an owner can see "why did this ingredient go down today".
   */
  reason: string
  /** referenceType on the inventoryMovements rows (e.g. 'pos_sale' or 'prep_batch'). */
  referenceType: string
  /** FK target — sale id, prep batch id, etc. */
  referenceId: string
  /** Prefix for the movement's `notes` column (e.g. "JQU-2026-00042" or "Prep Teh — 50 cup"). */
  notesPrefix: string
  /**
   * JUR-15 v2: which BOM rows to walk based on their `add_at` column.
   *   'all'    → all rows (existing non-prep-mode sale behavior).
   *   'prep'   → only rows with add_at='prep' (called from prep batch).
   *   'finish' → only rows with add_at='finish' (called from sale-time
   *              when the parent is prep_mode; pairs with FIFO consume).
   * Default 'all' keeps every existing caller working unchanged.
   */
  phase?: 'all' | 'prep' | 'finish'
  /** Caller appends materials that have no linked inventory item — surfaces as a notification once per material. */
  unlinkedMaterials: Map<string, string>
  /**
   * productId → productName for sub-recipes that COULD NOT be auto-
   * deducted: no positive `productionQty`, a recipe unit that doesn't
   * match `productionUnit`, or a recursion cycle. Caller surfaces one
   * notification per entry. An empty map means every sub-recipe was
   * deducted successfully.
   */
  unscalableSubRecipes: Map<string, string>
  /**
   * Internal — product ids already on the current recursion path.
   * Used to break A→B→A cycles. Callers leave this unset (defaults to
   * empty); the recursion threads it.
   */
  ancestorProductIds?: ReadonlySet<string>
  /** Internal — recursion depth, capped to guard pathological nesting. */
  depth?: number
  now: Date
}

/** Hard cap on sub-recipe nesting depth — a backstop beyond the cycle guard. */
const MAX_BOM_DEPTH = 8

export async function deductBomIngredients(args: DeductBomArgs): Promise<void> {
  const {
    tx,
    tenantId,
    userId,
    branchId,
    parentLinkedHppProductId,
    parentBaseQty,
    reason,
    referenceType,
    referenceId,
    notesPrefix,
    phase = 'all',
    unlinkedMaterials,
    unscalableSubRecipes,
    ancestorProductIds = new Set<string>(),
    depth = 0,
    now,
  } = args

  // Depth backstop — the cycle guard below catches real loops; this
  // just stops runaway recursion on pathological (acyclic) deep nests.
  if (depth > MAX_BOM_DEPTH) return

  // 1. Load the parent's BOM rows. Left-join materials for names in
  //    notifications; inner-join master_hpp_units for error text.
  //    Also pull add_at so we can filter by phase below.
  const bomRows = await tx
    .select({
      materialId: productMaterials.materialId,
      sourceProductId: productMaterials.sourceProductId,
      quantity: productMaterials.quantity,
      unitId: productMaterials.unitId,
      unitValue: masterHppUnits.value,
      materialName: materials.name,
      addAt: productMaterials.addAt,
    })
    .from(productMaterials)
    .leftJoin(materials, eq(materials.id, productMaterials.materialId))
    .innerJoin(masterHppUnits, eq(masterHppUnits.id, productMaterials.unitId))
    .where(eq(productMaterials.productId, parentLinkedHppProductId))
  if (bomRows.length === 0) return

  // 2. Filter to material-sourced rows, then apply the phase filter
  //    (JUR-15 v2). 'all' walks everything (existing single-phase sales);
  //    'prep' / 'finish' walk only matching rows. An empty result is
  //    fine — we fall through to sub-recipe recursion below (a recipe
  //    can be built entirely from sub-recipes with no direct materials).
  const materialRowsAll = bomRows.filter((r) => r.materialId != null)
  const materialRows =
    phase === 'all'
      ? materialRowsAll
      : materialRowsAll.filter((r) => (r.addAt ?? 'prep') === phase)

  const materialIds = materialRows.map((r) => r.materialId!) as string[]

  // 3. Find ingredient inventory items for each material. Active only.
  const ingredientItems = await tx
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      baseUnitId: inventoryItems.baseUnitId,
      costPrice: inventoryItems.costPrice,
      linkedHppMaterialId: inventoryItems.linkedHppMaterialId,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isActive, true),
        inArray(inventoryItems.linkedHppMaterialId, materialIds),
      ),
    )
  const itemByMaterialId = new Map(
    ingredientItems
      .filter((i) => i.linkedHppMaterialId != null)
      .map((i) => [i.linkedHppMaterialId as string, i] as const),
  )

  // 4. Pre-fetch per-(ingredient, unit) ratios so the deduction loop
  //    doesn't N+1. Only relevant when recipe unit ≠ ingredient base.
  const unitIds = Array.from(new Set(materialRows.map((r) => r.unitId)))
  const itemIds = ingredientItems.map((i) => i.id)
  const itemUnitRows =
    itemIds.length && unitIds.length
      ? await tx
          .select({
            itemId: inventoryItemUnits.itemId,
            unitId: inventoryItemUnits.unitId,
            ratioToBase: inventoryItemUnits.ratioToBase,
          })
          .from(inventoryItemUnits)
          .where(
            and(
              inArray(inventoryItemUnits.itemId, itemIds),
              inArray(inventoryItemUnits.unitId, unitIds),
            ),
          )
      : []
  const ratioByKey = new Map(
    itemUnitRows.map(
      (r) => [`${r.itemId}|${r.unitId}`, Number(r.ratioToBase)] as const,
    ),
  )

  // 5. Deduct each material row.
  for (const row of materialRows) {
    const ingredient = itemByMaterialId.get(row.materialId!)
    if (!ingredient) {
      unlinkedMaterials.set(row.materialId!, row.materialName ?? 'Bahan')
      continue
    }

    let ratio: number
    if (row.unitId === ingredient.baseUnitId) {
      ratio = 1
    } else {
      const found = ratioByKey.get(`${ingredient.id}|${row.unitId}`)
      if (found == null) {
        throw new Error(
          `Bahan "${ingredient.name}" satuan resep (${row.unitValue}) tidak cocok dengan satuan inventaris. Tambahkan unit "${row.unitValue}" di konfigurasi item, atau perbaiki satuan resep.`,
        )
      }
      ratio = found
    }

    const consumeBase = Number(row.quantity) * parentBaseQty * ratio
    if (!Number.isFinite(consumeBase) || consumeBase <= 0) continue

    // unitCost snapshot = current ingredient cost so future P&L (JUR-11)
    // can compute true gross margin by joining sale → ingredient_movement.
    await tx.insert(inventoryMovements).values({
      tenantId,
      itemId: ingredient.id,
      branchId,
      movementType: 'out',
      quantity: consumeBase.toString(),
      unitCost: ingredient.costPrice
        ? Number(ingredient.costPrice).toString()
        : null,
      reason,
      referenceType,
      referenceId,
      notes: `${notesPrefix} → ${row.materialName ?? 'bahan'}`,
      performedBy: userId,
    })

    // Balance upsert. Negative stock allowed (matches existing behaviour).
    const [existing] = await tx
      .select({
        id: inventoryStockBalances.id,
        quantity: inventoryStockBalances.quantity,
      })
      .from(inventoryStockBalances)
      .where(
        and(
          eq(inventoryStockBalances.itemId, ingredient.id),
          eq(inventoryStockBalances.branchId, branchId),
        ),
      )
      .limit(1)
    if (existing) {
      const newQty = Number(existing.quantity) - consumeBase
      await tx
        .update(inventoryStockBalances)
        .set({
          quantity: newQty.toString(),
          lastMovementAt: now,
          updatedAt: now,
        })
        .where(eq(inventoryStockBalances.id, existing.id))
    } else {
      await tx.insert(inventoryStockBalances).values({
        tenantId,
        itemId: ingredient.id,
        branchId,
        quantity: (-consumeBase).toString(),
        lastMovementAt: now,
      })
    }
  }

  // 6. Recurse into sub-product rows. A row "{ sourceProductId: X,
  //    quantity: q, unit: u }" means the recipe uses `q` (in unit `u`)
  //    of product X per parent unit. X is produced in batches of
  //    X.productionQty — so the recipe consumes `q / productionQty`
  //    batches of X, scaled by parentBaseQty. Recurse with that as the
  //    child's parentBaseQty so X's own materials deduct correctly.
  const subRows = bomRows.filter((r) => r.sourceProductId != null)
  const subRowsPhased =
    phase === 'all'
      ? subRows
      : subRows.filter((r) => (r.addAt ?? 'prep') === phase)
  if (subRowsPhased.length === 0) return

  const subProductIds = Array.from(
    new Set(subRowsPhased.map((r) => r.sourceProductId!)),
  )
  const subProducts = await tx
    .select({
      id: products.id,
      name: products.name,
      productionQty: products.productionQty,
      productionUnit: products.productionUnit,
    })
    .from(products)
    .where(inArray(products.id, subProductIds))
  const subProductById = new Map(subProducts.map((p) => [p.id, p] as const))

  // Ancestor path for the cycle guard one level down.
  const nextAncestors = new Set<string>([
    ...ancestorProductIds,
    parentLinkedHppProductId,
  ])

  for (const row of subRowsPhased) {
    const sub = subProductById.get(row.sourceProductId!)
    if (!sub) continue

    // Cycle guard: never recurse into a product already on the current
    // path. A→B→A would otherwise loop until the depth cap.
    if (
      sub.id === parentLinkedHppProductId ||
      ancestorProductIds.has(sub.id)
    ) {
      unscalableSubRecipes.set(sub.id, sub.name)
      continue
    }

    // Unscalable: no positive production qty, or the recipe row's unit
    // doesn't match the sub-product's production unit. Skip + track for
    // a notification — never block the sale over a recipe-config gap.
    const prodQty = sub.productionQty != null ? Number(sub.productionQty) : 0
    if (
      !Number.isFinite(prodQty) ||
      prodQty <= 0 ||
      (sub.productionUnit ?? '') !== (row.unitValue ?? '')
    ) {
      unscalableSubRecipes.set(sub.id, sub.name)
      continue
    }

    const childBaseQty = (Number(row.quantity) * parentBaseQty) / prodQty
    if (!Number.isFinite(childBaseQty) || childBaseQty <= 0) continue

    await deductBomIngredients({
      tx,
      tenantId,
      userId,
      branchId,
      parentLinkedHppProductId: sub.id,
      parentBaseQty: childBaseQty,
      reason,
      referenceType,
      referenceId,
      notesPrefix: `${notesPrefix} → ${sub.name}`,
      // The sub-product is consumed as a whole unit, so walk every one
      // of its BOM rows regardless of add_at.
      phase: 'all',
      unlinkedMaterials,
      unscalableSubRecipes,
      ancestorProductIds: nextAncestors,
      depth: depth + 1,
      now,
    })
  }
}
