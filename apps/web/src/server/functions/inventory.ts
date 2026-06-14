import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  inventoryItems,
  inventoryItemUnits,
  inventoryItemUnitPricing,
  inventoryStockBalances,
  inventoryMovements,
  inventorySettings,
  purchaseOrderItems,
  branches,
  materials,
  products,
  productMaterials,
  suppliers,
  tenantCategories,
  masterHppUnits,
} from '@vintra/db/schema'
import { and, eq, sql, desc, gte, ilike, inArray, isNull } from 'drizzle-orm'
import {
  inventoryTierLimits,
  type InventoryFeatureFlag,
  type InventoryTierKey,
} from '@vintra/shared'
import { requireAuth } from '../middleware/auth'
import { requireInventoryAccess } from '../middleware/module-access'
import {
  assertBranchAllowed,
  filterBranchesByAccess,
  branchScopeWhere,
} from '../lib/branch-scope'
import {
  uploadInventoryItemPhoto,
  getInventoryPhotoSignedUrl,
  deleteInventoryPhoto,
  parseDataUrl,
} from '@/lib/s3-storage'

/**
 * Recipe panel view types for the inventory item detail page (JUR-10).
 * Declared at module scope (not inside the handler) so the recursive
 * `RecipeSubRecipe.subRecipes: RecipeSubRecipe[]` reference survives
 * return-type inference and can be imported by the route component.
 */
export type RecipeIngredientView = {
  materialId: string
  materialName: string
  quantity: number
  unit: string
  ingredientItemId: string | null
  ingredientItemName: string | null
}
export type RecipeSubRecipe = {
  productId: string
  productName: string
  /** Amount of this sub-recipe used by its PARENT recipe. */
  quantity: number
  unit: string
  productionQty: number | null
  productionUnit: string | null
  /** False when the sub-recipe can't be auto-deducted (no production
   *  qty, unit mismatch, or a recursion cycle). */
  scalable: boolean
  ingredients: RecipeIngredientView[]
  subRecipes: RecipeSubRecipe[]
}

// ─── Tier-cap + feature enforcement ──────────────────────────────────

/**
 * Throws when the tenant is at their SKU cap. Counts ACTIVE items only —
 * deactivated SKUs are kept for historical movement integrity but don't
 * consume a slot. Mirrors `assertCanConsumeStaffSlot` for attendance.
 */
async function assertCanConsumeSKUSlot(
  tenantId: string,
  tier: InventoryTierKey,
) {
  const limits = inventoryTierLimits(tier)
  if (limits.skuCap == null) return // unlimited

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isActive, true),
      ),
    )

  const count = row?.count ?? 0
  if (count >= limits.skuCap) {
    throw new Error(
      `Batas SKU tercapai (${count}/${limits.skuCap}). Upgrade paket untuk menambah lebih banyak item.`,
    )
  }
}

/**
 * Branches are a tenant-wide resource (shared with attendance). The
 * inventory tier cap counts ALL active branches the tenant has — if
 * a Free tenant already has 1 branch (from attendance setup), the
 * inventory module cannot create another one. This avoids the gap
 * where Free users could spawn unlimited branches via inventory by
 * never recording stock at them.
 */
async function countInventoryBranches(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
  return row?.count ?? 0
}

async function assertCanConsumeBranchSlot(
  tenantId: string,
  tier: InventoryTierKey,
) {
  const limits = inventoryTierLimits(tier)
  if (limits.branchCap == null) return

  const used = await countInventoryBranches(tenantId)
  if (used >= limits.branchCap) {
    throw new Error(
      `Batas cabang tercapai (${used}/${limits.branchCap}). Upgrade paket untuk menambah cabang.`,
    )
  }
}

function assertFeatureAvailable(
  tier: InventoryTierKey,
  feature: InventoryFeatureFlag,
) {
  const limits = inventoryTierLimits(tier)
  if (!limits.features.includes(feature)) {
    throw new Error(
      `Fitur ini hanya tersedia di paket berbayar. Upgrade untuk mengaktifkan.`,
    )
  }
}

/**
 * Returns the tenant's "main inventory branch" id, auto-creating the
 * inventory_settings row + auto-picking the oldest active branch on
 * first call. This is what enforces the Free tier's "1 branch only"
 * constraint without requiring a forced setup modal — first time the
 * user opens inventory, we just pick a sensible default for them.
 *
 * Returns null when the tenant has zero branches (very fresh tenant
 * pre-onboarding); callers should handle that as "no inventory ops
 * possible until a branch exists."
 */
async function ensureMainBranchId(tenantId: string): Promise<string | null> {
  // Source of truth is now `branches.is_main` (set explicitly via the
  // master/branches form). Fall back to the legacy
  // `inventory_settings.main_branch_id` for tenants that haven't been
  // migrated yet, then fall back to oldest active.
  const [marked] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.tenantId, tenantId),
        eq(branches.isMain, true),
        eq(branches.isActive, true),
      ),
    )
    .limit(1)
  if (marked) {
    // Keep legacy column in sync so older code paths still see it.
    await db
      .insert(inventorySettings)
      .values({ tenantId, mainBranchId: marked.id })
      .onConflictDoUpdate({
        target: inventorySettings.tenantId,
        set: { mainBranchId: marked.id, updatedAt: new Date() },
      })
    return marked.id
  }

  const [settings] = await db
    .select({ mainBranchId: inventorySettings.mainBranchId })
    .from(inventorySettings)
    .where(eq(inventorySettings.tenantId, tenantId))
    .limit(1)
  if (settings?.mainBranchId) return settings.mainBranchId

  const [oldest] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
    .orderBy(branches.createdAt)
    .limit(1)

  if (!oldest) return null

  await db
    .insert(inventorySettings)
    .values({ tenantId, mainBranchId: oldest.id })
    .onConflictDoUpdate({
      target: inventorySettings.tenantId,
      set: { mainBranchId: oldest.id, updatedAt: new Date() },
    })
  // Mark it main on the branches table so the next call hits the fast path.
  await db
    .update(branches)
    .set({ isMain: true, updatedAt: new Date() })
    .where(and(eq(branches.id, oldest.id), eq(branches.tenantId, tenantId)))
  return oldest.id
}

/**
 * Free-tier branch guard. Throws when a Free tenant tries to write
 * stock at any branch other than their main branch. Paid tiers bypass
 * the check — they have unlimited branch access. Called from
 * recordMovement; callers can also call it directly for early
 * validation in the UI layer if needed.
 */
async function assertBranchAllowedForTier(
  tenantId: string,
  tier: InventoryTierKey,
  branchId: string,
) {
  if (tier !== 'free') return
  const mainBranchId = await ensureMainBranchId(tenantId)
  if (!mainBranchId) {
    throw new Error('Cabang utama belum diatur. Tambah cabang dulu lalu coba lagi.')
  }
  if (branchId !== mainBranchId) {
    throw new Error(
      'Paket Free hanya boleh catat stok di cabang utama. Upgrade ke Toko untuk catat di semua cabang.',
    )
  }
}

// ─── Read endpoints (Free + above) ───────────────────────────────────

/**
 * Dashboard payload: tier badge, cap utilisation, headline stats.
 */
export const getInventoryOverview = createServerFn()
  .inputValidator(
    z.object({ branchId: z.string().uuid().optional() }).optional(),
  )
  .handler(async ({ data }) => {
  const auth = await requireInventoryAccess()
  const limits = inventoryTierLimits(auth.inventoryTier)

  // Optional branch scope (topbar branch switcher). The SKU catalog
  // count stays tenant-wide — items aren't branch-keyed — while the
  // stock-derived stats (low-stock, stock value) reflect only the
  // selected branch. No branchId ⇒ aggregate across every branch.
  const branchId = data?.branchId
  if (branchId) assertBranchAllowed(auth, branchId)
  const branchFilter = branchId
    ? sql`AND b.branch_id = ${branchId}`
    : sql``

  const [
    [activeItemCountRow],
    [lowStockCountRow],
    [stockValueRow],
    branchesUsed,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.isActive, true),
        ),
      ),
    // Low-stock = balance < min_stock_level on the scoped branch(es).
    db.execute<{ count: number }>(sql`
      SELECT count(distinct i.id)::int AS count
      FROM inventory_items i
      JOIN inventory_stock_balances b ON b.item_id = i.id
      WHERE i.tenant_id = ${auth.tenantId}
        AND i.is_active = true
        AND i.min_stock_level IS NOT NULL
        AND b.quantity < i.min_stock_level
        ${branchFilter}
    `),
    db.execute<{ value: number | null }>(sql`
      SELECT COALESCE(SUM(b.quantity * i.cost_price), 0)::numeric AS value
      FROM inventory_items i
      JOIN inventory_stock_balances b ON b.item_id = i.id
      WHERE i.tenant_id = ${auth.tenantId}
        AND i.is_active = true
        ${branchFilter}
    `),
    countInventoryBranches(auth.tenantId),
  ])

  // Resolve (and lazy-default) the main branch so the dashboard can
  // surface "Cabang utama: X · Ubah" without an extra round-trip.
  const mainBranchId = await ensureMainBranchId(auth.tenantId)
  let mainBranch: { id: string; name: string } | null = null
  if (mainBranchId) {
    const [b] = await db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.id, mainBranchId))
      .limit(1)
    mainBranch = b ?? null
  }

  return {
    tier: auth.inventoryTier,
    caps: {
      skuCap: limits.skuCap,
      branchCap: limits.branchCap,
      historyDays: limits.movementHistoryDays,
    },
    usage: {
      activeItems: activeItemCountRow?.count ?? 0,
      lowStockItems: Number(lowStockCountRow?.count ?? 0),
      branches: branchesUsed,
      stockValueIdr: Number(stockValueRow?.value ?? 0),
    },
    features: limits.features,
    mainBranch,
  }
})

/**
 * Set or change the Free-tier "main inventory branch". Toko+ tenants
 * may also call this — it has no effect on their stock access (paid
 * tiers are unlimited) but still records a preferred default for the
 * UI to use when nothing else is selected.
 */
export const setInventoryMainBranch = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    // Verify the branch belongs to this tenant before pointing
    // inventory_settings at it.
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.id, data.branchId),
          eq(branches.tenantId, auth.tenantId),
          eq(branches.isActive, true),
        ),
      )
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan')

    await db
      .insert(inventorySettings)
      .values({ tenantId: auth.tenantId, mainBranchId: data.branchId })
      .onConflictDoUpdate({
        target: inventorySettings.tenantId,
        set: { mainBranchId: data.branchId, updatedAt: new Date() },
      })

    return { mainBranchId: data.branchId }
  })

const listItemsInput = z.object({
  branchId: z.string().uuid().optional(),
  search: z.string().optional(),
  lowStockOnly: z.boolean().optional().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
})

export const listInventoryItems = createServerFn({ method: 'POST' })
  .inputValidator(listItemsInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const conds = [
      eq(inventoryItems.tenantId, auth.tenantId),
      eq(inventoryItems.isActive, true),
    ]
    if (data.search) {
      conds.push(ilike(inventoryItems.name, `%${data.search}%`))
    }

    // Paginated item list with current balance summed across all branches
    // (or filtered to a specific branch if requested).
    const offset = (data.page - 1) * data.pageSize
    // JUR-135: balance roll-up is branch-keyed via the b alias on
    // inventory_stock_balances. If caller explicitly filters by a
    // branch they must have access; otherwise we restrict to the
    // pinned set so a cashier doesn't see "100 units across all
    // branches" when they can only sell on Cabang BSD.
    if (data.branchId) assertBranchAllowed(auth, data.branchId)
    const balanceFilter = data.branchId
      ? sql`AND b.branch_id = ${data.branchId}`
      : auth.allowedBranchIds === null
        ? sql``
        : sql`AND b.branch_id = ANY(${auth.allowedBranchIds}::uuid[])`

    const itemsQ = await db.execute<{
      id: string
      sku: string | null
      name: string
      // Effective brand: own column when present, else fall back to
      // the linked HPP material's brand. Resolved in SQL (COALESCE)
      // so the row payload is already merged for every consumer.
      brand: string | null
      category_name: string | null
      base_unit_value: string
      base_unit_label: string
      cost_price: string
      lowest_base_unit_price: string | null
      pricing_unit_count: number
      min_stock_level: string | null
      photo_key: string | null
      total_quantity: string
      branches_count: number
      linked_hpp_product_id: string | null
      is_sellable: boolean
      is_bookable: boolean
      is_favorite: boolean
      category_id: string | null
    }>(sql`
      SELECT
        i.id, i.sku, i.name,
        COALESCE(NULLIF(i.brand, ''), m.brand) AS brand,
        c.name AS category_name,
        i.category_id,
        u.value AS base_unit_value, u.label AS base_unit_label,
        i.cost_price,
        i.min_stock_level, i.photo_key,
        i.linked_hpp_product_id,
        i.is_sellable,
        i.is_bookable,
        i.is_favorite,
        COALESCE(SUM(b.quantity), 0) AS total_quantity,
        COUNT(DISTINCT b.branch_id)::int AS branches_count,
        -- Cheapest tier 1 price across all units, normalised back to
        -- per-base-unit so list comparisons stay apples-to-apples.
        (
          SELECT MIN(p.unit_price::numeric / u2.ratio_to_base::numeric)
          FROM inventory_item_unit_pricing p
          JOIN inventory_item_units u2
            ON u2.item_id = p.item_id AND u2.unit_id = p.unit_id
          WHERE p.item_id = i.id AND p.min_qty = 1
        ) AS lowest_base_unit_price,
        -- How many distinct units have at least one price tier set
        (
          SELECT COUNT(DISTINCT p.unit_id)::int
          FROM inventory_item_unit_pricing p
          WHERE p.item_id = i.id
        ) AS pricing_unit_count
      FROM inventory_items i
      LEFT JOIN tenant_categories c ON c.id = i.category_id
      JOIN master_hpp_units u ON u.id = i.base_unit_id
      LEFT JOIN materials m ON m.id = i.linked_hpp_material_id
      LEFT JOIN inventory_stock_balances b ON b.item_id = i.id ${balanceFilter}
      WHERE i.tenant_id = ${auth.tenantId} AND i.is_active = true
        ${data.search ? sql`AND i.name ILIKE ${`%${data.search}%`}` : sql``}
      GROUP BY i.id, m.brand, c.name, u.value, u.label, i.linked_hpp_product_id, i.is_sellable, i.is_bookable, i.is_favorite, i.category_id
      ${
        data.lowStockOnly
          ? sql`HAVING i.min_stock_level IS NOT NULL
                  AND COALESCE(SUM(b.quantity), 0) < i.min_stock_level`
          : sql``
      }
      ORDER BY i.name ASC
      LIMIT ${data.pageSize}
      OFFSET ${offset}
    `)

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(and(...conds))

    return {
      items: itemsQ.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        brand: r.brand,
        categoryName: r.category_name,
        categoryId: r.category_id,
        baseUnit: { value: r.base_unit_value, label: r.base_unit_label },
        costPrice: Number(r.cost_price),
        /**
         * Cheapest tier-1 price across all units, expressed per base
         * unit so list comparisons are apples-to-apples. Null when no
         * pricing tier exists yet (item not sellable in cashier).
         */
        lowestBaseUnitPrice: r.lowest_base_unit_price
          ? Number(r.lowest_base_unit_price)
          : null,
        /** How many distinct units have at least 1 tier — 0 means "no pricing yet". */
        pricingUnitCount: Number(r.pricing_unit_count),
        minStockLevel: r.min_stock_level ? Number(r.min_stock_level) : null,
        photoKey: r.photo_key,
        totalQuantity: Number(r.total_quantity),
        branchesCount: r.branches_count,
        isLowStock:
          r.min_stock_level != null &&
          Number(r.total_quantity) < Number(r.min_stock_level),
        /**
         * Service-mode flag — items linked to a recipe-backed HPP
         * product have no own stock balance (sale-time BOM walker
         * deducts ingredients instead). Lists show a "Resep" pill;
         * stock-in / adjust forms exclude these so the cashier can't
         * accidentally write a stock movement that the model won't
         * use.
         */
        recipeBacked: Boolean(r.linked_hpp_product_id),
        /** Whether the item appears in the POS catalog (Case 2). */
        isSellable: Boolean(r.is_sellable),
        /** JUR-183: whether the item appears in the booking service picker. */
        isBookable: Boolean(r.is_bookable),
        /** JUR-39: surfaced first in the cashier grid; toggled inline from the list. */
        isFavorite: Boolean(r.is_favorite),
      })),
      total: totalRow?.count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

export const getInventoryItem = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.id),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)

    if (!item) throw new Error('Item tidak ditemukan')

    const limits = inventoryTierLimits(auth.inventoryTier)
    const historyClamp = limits.movementHistoryDays
      ? sql`AND m.created_at >= now() - interval '${sql.raw(String(limits.movementHistoryDays))} days'`
      : sql``

    const [perBranch, recentMovements, units, tiers] = await Promise.all([
      db.execute<{
        branch_id: string
        branch_name: string
        quantity: string
        last_movement_at: Date | null
      }>(sql`
        SELECT b.id AS branch_id, b.name AS branch_name,
               sb.quantity, sb.last_movement_at
        FROM inventory_stock_balances sb
        JOIN branches b ON b.id = sb.branch_id
        WHERE sb.item_id = ${data.id} AND sb.tenant_id = ${auth.tenantId}
        ORDER BY b.name ASC
      `),
      db.execute<{
        id: string
        movement_type: string
        quantity: string
        unit_cost: string | null
        reason: string | null
        notes: string | null
        created_at: Date
        branch_name: string
      }>(sql`
        SELECT m.id, m.movement_type, m.quantity, m.unit_cost,
               m.reason, m.notes, m.created_at,
               b.name AS branch_name
        FROM inventory_movements m
        JOIN branches b ON b.id = m.branch_id
        WHERE m.item_id = ${data.id} AND m.tenant_id = ${auth.tenantId}
        ${historyClamp}
        ORDER BY m.created_at DESC
        LIMIT 50
      `),
      // All configured units (incl. base) for this item.
      db
        .select({
          id: inventoryItemUnits.id,
          unitId: inventoryItemUnits.unitId,
          unitValue: masterHppUnits.value,
          unitLabel: masterHppUnits.label,
          ratioToBase: inventoryItemUnits.ratioToBase,
          sortOrder: inventoryItemUnits.sortOrder,
          isDefault: inventoryItemUnits.isDefault,
        })
        .from(inventoryItemUnits)
        .innerJoin(
          masterHppUnits,
          eq(inventoryItemUnits.unitId, masterHppUnits.id),
        )
        .where(eq(inventoryItemUnits.itemId, data.id))
        .orderBy(inventoryItemUnits.sortOrder, masterHppUnits.label),
      // All pricing tiers for this item, grouped by unit.
      db
        .select({
          id: inventoryItemUnitPricing.id,
          unitId: inventoryItemUnitPricing.unitId,
          minQty: inventoryItemUnitPricing.minQty,
          unitPrice: inventoryItemUnitPricing.unitPrice,
        })
        .from(inventoryItemUnitPricing)
        .where(eq(inventoryItemUnitPricing.itemId, data.id))
        .orderBy(inventoryItemUnitPricing.unitId, inventoryItemUnitPricing.minQty),
    ])

    // Inline the photo signed URL on the detail payload — the page
    // renders one item, one photo, so doing it here saves the client
    // a separate round-trip via getInventoryPhotoUrls.
    let photoUrl: string | null = null
    if (item.photoKey) {
      try {
        photoUrl = await getInventoryPhotoSignedUrl(item.photoKey, 300)
      } catch {
        photoUrl = null
      }
    }

    // Resolve the linked HPP material's brand so the detail page (and
    // edit form) can show it as a fallback when the item itself has no
    // brand set. Surfaced separately from `item.brand` so the UI can
    // render "From HPP: X" copy when the fallback kicks in.
    let linkedHppBrand: string | null = null
    if (item.linkedHppMaterialId) {
      const [mat] = await db
        .select({ brand: materials.brand })
        .from(materials)
        .where(eq(materials.id, item.linkedHppMaterialId))
        .limit(1)
      linkedHppBrand = mat?.brand ?? null
    }

    // Recipe ingredients (JUR-10). When this item has a linked HPP
    // product, list the materials that get auto-deducted on every
    // sale + flag any unlinked ones so the owner can fix them. The
    // detail page renders a "Stok-out otomatis" panel from this.
    //
    // Sub-recipes (BOM rows referencing another HPP product) are
    // walked recursively so the panel can show the full nested tree.
    // View types live at module scope (RecipeIngredientView /
    // RecipeSubRecipe) so the recursive shape survives inference.
    const MAX_RECIPE_DEPTH = 8

    let recipeIngredients: RecipeIngredientView[] | null = null
    let subRecipes: RecipeSubRecipe[] = []
    if (item.linkedHppProductId) {
      // Raw (pre-link-enrichment) tree node — materials carry just the
      // BOM data; the inventory-item link is filled in after one
      // batched lookup across the whole tree.
      type RawMaterial = {
        materialId: string
        materialName: string
        quantity: number
        unit: string
      }
      type RawSub = {
        productId: string
        productName: string
        quantity: number
        unit: string
        productionQty: number | null
        productionUnit: string | null
        scalable: boolean
        materials: RawMaterial[]
        subRecipes: RawSub[]
      }
      const allMaterialIds = new Set<string>()

      async function loadRecipeNode(
        productId: string,
        ancestors: ReadonlySet<string>,
        depth: number,
      ): Promise<{ materials: RawMaterial[]; subRecipes: RawSub[] }> {
        if (depth > MAX_RECIPE_DEPTH) return { materials: [], subRecipes: [] }
        // JUR-14: unit text is gone — join master_hpp_units for the
        // recipe row's unit value.
        const bom = await db
          .select({
            materialId: productMaterials.materialId,
            sourceProductId: productMaterials.sourceProductId,
            quantity: productMaterials.quantity,
            unit: masterHppUnits.value,
            materialName: materials.name,
          })
          .from(productMaterials)
          .leftJoin(materials, eq(materials.id, productMaterials.materialId))
          .innerJoin(
            masterHppUnits,
            eq(masterHppUnits.id, productMaterials.unitId),
          )
          .where(eq(productMaterials.productId, productId))

        const materialRows: RawMaterial[] = bom
          .filter((r) => r.materialId != null)
          .map((r) => {
            allMaterialIds.add(r.materialId!)
            return {
              materialId: r.materialId!,
              materialName: r.materialName ?? 'Bahan',
              quantity: Number(r.quantity),
              unit: r.unit,
            }
          })

        const subRows = bom.filter((r) => r.sourceProductId != null)
        const subNodes: RawSub[] = []
        if (subRows.length > 0) {
          const subIds = Array.from(
            new Set(subRows.map((r) => r.sourceProductId!)),
          )
          const subProducts = await db
            .select({
              id: products.id,
              name: products.name,
              productionQty: products.productionQty,
              productionUnit: products.productionUnit,
            })
            .from(products)
            .where(inArray(products.id, subIds))
          const subById = new Map(subProducts.map((p) => [p.id, p] as const))
          const nextAncestors = new Set<string>([...ancestors, productId])

          for (const row of subRows) {
            const sub = subById.get(row.sourceProductId!)
            if (!sub) continue
            const cyclic =
              sub.id === productId || ancestors.has(sub.id)
            const prodQty =
              sub.productionQty != null ? Number(sub.productionQty) : 0
            const scalable =
              !cyclic &&
              Number.isFinite(prodQty) &&
              prodQty > 0 &&
              (sub.productionUnit ?? '') === (row.unit ?? '')
            const child = cyclic
              ? { materials: [], subRecipes: [] }
              : await loadRecipeNode(sub.id, nextAncestors, depth + 1)
            subNodes.push({
              productId: sub.id,
              productName: sub.name,
              quantity: Number(row.quantity),
              unit: row.unit,
              productionQty:
                sub.productionQty != null ? Number(sub.productionQty) : null,
              productionUnit: sub.productionUnit,
              scalable,
              materials: child.materials,
              subRecipes: child.subRecipes,
            })
          }
        }
        return { materials: materialRows, subRecipes: subNodes }
      }

      const rawTree = await loadRecipeNode(
        item.linkedHppProductId,
        new Set<string>(),
        0,
      )

      // One batched lookup: which materials (anywhere in the tree) have
      // a linked inventory item. Drives the "linked / unlinked" badge.
      const matIds = Array.from(allMaterialIds)
      const ingredientItems =
        matIds.length > 0
          ? await db
              .select({
                id: inventoryItems.id,
                name: inventoryItems.name,
                linkedHppMaterialId: inventoryItems.linkedHppMaterialId,
              })
              .from(inventoryItems)
              .where(
                and(
                  eq(inventoryItems.tenantId, auth.tenantId),
                  eq(inventoryItems.isActive, true),
                  inArray(inventoryItems.linkedHppMaterialId, matIds),
                ),
              )
          : []
      const itemByMaterialId = new Map(
        ingredientItems
          .filter((i) => i.linkedHppMaterialId != null)
          .map((i) => [i.linkedHppMaterialId as string, i] as const),
      )

      const enrichMaterial = (m: RawMaterial): RecipeIngredientView => {
        const ing = itemByMaterialId.get(m.materialId)
        return {
          materialId: m.materialId,
          materialName: m.materialName,
          quantity: m.quantity,
          unit: m.unit,
          ingredientItemId: ing?.id ?? null,
          ingredientItemName: ing?.name ?? null,
        }
      }
      const enrichSub = (s: RawSub): RecipeSubRecipe => ({
        productId: s.productId,
        productName: s.productName,
        quantity: s.quantity,
        unit: s.unit,
        productionQty: s.productionQty,
        productionUnit: s.productionUnit,
        scalable: s.scalable,
        ingredients: s.materials.map(enrichMaterial),
        subRecipes: s.subRecipes.map(enrichSub),
      })

      recipeIngredients = rawTree.materials.map(enrichMaterial)
      subRecipes = rawTree.subRecipes.map(enrichSub)
    }

    // Bundle each unit with its tier ladder for the editor UI.
    const tiersByUnitId = new Map<
      string,
      Array<{ id: string; minQty: number; unitPrice: number }>
    >()
    for (const t of tiers) {
      const arr = tiersByUnitId.get(t.unitId) ?? []
      arr.push({
        id: t.id,
        minQty: Number(t.minQty),
        unitPrice: Number(t.unitPrice),
      })
      tiersByUnitId.set(t.unitId, arr)
    }

    const unitsWithTiers = units.map((u) => ({
      id: u.id,
      unitId: u.unitId,
      unitValue: u.unitValue,
      unitLabel: u.unitLabel,
      ratioToBase: Number(u.ratioToBase),
      sortOrder: u.sortOrder,
      isBase: u.unitId === item.baseUnitId,
      isDefault: u.isDefault,
      tiers: tiersByUnitId.get(u.unitId) ?? [],
    }))

    return {
      ...item,
      tier: auth.inventoryTier,
      photoUrl,
      linkedHppBrand,
      costPrice: Number(item.costPrice),
      franchisePrice:
        item.franchisePrice != null ? Number(item.franchisePrice) : null,
      minStockLevel: item.minStockLevel ? Number(item.minStockLevel) : null,
      perBranch: perBranch.map((b) => ({
        branchId: b.branch_id,
        branchName: b.branch_name,
        quantity: Number(b.quantity),
        lastMovementAt: b.last_movement_at,
      })),
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        type: m.movement_type,
        quantity: Number(m.quantity),
        unitCost: m.unit_cost ? Number(m.unit_cost) : null,
        reason: m.reason,
        notes: m.notes,
        createdAt: m.created_at,
        branchName: m.branch_name,
      })),
      /** All units configured for this item (incl. base), each with its tier ladder. */
      units: unitsWithTiers,
      /** JUR-10 recipe panel: top-level materials that get auto-
       *  deducted when this item is sold. Null when item has no
       *  recipe. */
      recipeIngredients,
      /** Nested sub-recipes (products within the recipe), each with
       *  its own ingredients + sub-recipes — walked recursively. */
      subRecipes,
    }
  })

// ─── Mutations: items ────────────────────────────────────────────────

/**
 * When an inventory item links to an HPP material, the item's base unit
 * MUST match the material's unit string. Otherwise stock-in's HPP price
 * sync writes a per-pcs cost into a per-gram price column, breaking HPP
 * by the conversion ratio. Throws a friendly Indonesian error.
 */
async function assertHppUnitMatchesBase(
  baseUnitId: string,
  linkedHppMaterialId: string,
) {
  const [unitRow] = await db
    .select({ value: masterHppUnits.value, label: masterHppUnits.label })
    .from(masterHppUnits)
    .where(eq(masterHppUnits.id, baseUnitId))
    .limit(1)
  // JUR-14: comparison is now FK-to-FK — same id ⇒ same unit. No
  // string normalisation needed.
  const [matRow] = await db
    .select({ unitId: materials.unitId, name: materials.name })
    .from(materials)
    .where(eq(materials.id, linkedHppMaterialId))
    .limit(1)
  if (!unitRow || !matRow) return // FK constraint handles non-existence
  if (baseUnitId !== matRow.unitId) {
    // Resolve the material's unit label for the error message.
    const [matUnit] = await db
      .select({ label: masterHppUnits.label, value: masterHppUnits.value })
      .from(masterHppUnits)
      .where(eq(masterHppUnits.id, matRow.unitId))
      .limit(1)
    throw new Error(
      `Unit dasar item (${unitRow.label}) tidak cocok dengan unit Bahan HPP "${matRow.name}" (${matUnit?.label ?? matUnit?.value ?? '?'}). Set unit dasar atau hapus tautan HPP.`,
    )
  }
}

const itemInput = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  sku: z.string().max(50).optional().nullable(),
  brand: z.string().max(100).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  baseUnitId: z.string().uuid(),
  costPrice: z.coerce.number().min(0).default(0),
  /**
   * Price HQ charges a franchise branch for this item via the
   * inter-branch requisition. Null = not offered to franchises (the
   * item can't be ordered by a franchise outlet).
   */
  franchisePrice: z.coerce.number().min(0).nullable().optional(),
  /**
   * Optional initial selling price (per base unit). When provided, the
   * server seeds a tier-1 pricing row on the base unit so the item is
   * sellable in POS immediately after creation. Leave empty to skip
   * pricing setup at creation time and configure tiers later from the
   * item detail page.
   */
  initialSellingPrice: z.coerce.number().min(0).optional().nullable(),
  minStockLevel: z.coerce.number().min(0).optional().nullable(),
  photoKey: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  linkedHppMaterialId: z.string().uuid().optional().nullable(),
  linkedHppProductId: z.string().uuid().optional().nullable(),
  /** Per-item override for the HPP price sync. Only meaningful when
   *  linkedHppMaterialId is set; ignored otherwise. Defaults to true
   *  in the DB so legacy callers that never pass this still get the
   *  historical "always sync" behaviour. */
  autoSyncHppCost: z.boolean().optional(),
  /**
   * Whether the item shows in the POS catalog. Smart default at
   * create: false when linkedHppMaterialId is set (raw ingredient),
   * true otherwise. Admin can override per-item from the form.
   */
  isSellable: z.boolean().optional(),
  /**
   * JUR-183: surfaces this item in the booking service picker. Default
   * false at create; tenant flips per-item in /inventory/items. When
   * true (and is_sellable=true), the item appears in /booking's
   * create-booking sheet service list.
   */
  isBookable: z.boolean().optional(),
  /** JUR-183: hex color for the calendar bubble, null falls back to grey. */
  bookingColor: z.string().max(20).nullable().optional(),
  /**
   * JUR-183: how many minutes this service takes when booked. Null
   * falls back to booking_settings.slot_duration_min, then to 30 min.
   * Lets a salon set "Smoothing = 90 min" even when the default slot
   * is 30 min.
   */
  bookingDurationMin: z.number().int().min(1).max(720).nullable().optional(),
  /**
   * JUR-15: prep-mode toggle. Only valid for recipe-backed items
   * (linkedHppProductId set). DB CHECK constraint enforces, but we
   * also clear it server-side on update when the recipe link is
   * removed so the toggle can't get stuck in an invalid state.
   */
  prepMode: z.boolean().optional(),
  /**
   * Pin to top of the POS "Semua" view. Toggled from the item detail
   * page; ignored when category filter is active in the cashier.
   */
  isFavorite: z.boolean().optional(),
  /** Toko Online: buyable on the public storefront (opt-in per item). */
  isOnline: z.boolean().optional(),
  /** Per-unit shipping weight in grams (manual ongkir reference). */
  shippingWeightGrams: z.coerce.number().int().min(0).nullable().optional(),
  /** Optional cap on stock exposed online, in base unit. */
  onlineStockCap: z.coerce.number().min(0).nullable().optional(),
})

export const createInventoryItem = createServerFn({ method: 'POST' })
  .inputValidator(itemInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    await assertCanConsumeSKUSlot(auth.tenantId, auth.inventoryTier)

    if (data.linkedHppMaterialId) {
      await assertHppUnitMatchesBase(data.baseUnitId, data.linkedHppMaterialId)
    }

    const row = await db.transaction(async (tx) => {
      const [item] = await tx
        .insert(inventoryItems)
        .values({
          tenantId: auth.tenantId,
          name: data.name,
          sku: data.sku?.trim() || null,
          brand: data.brand?.trim() || null,
          categoryId: data.categoryId ?? null,
          baseUnitId: data.baseUnitId,
          costPrice: data.costPrice.toString(),
          franchisePrice:
            data.franchisePrice != null
              ? data.franchisePrice.toString()
              : null,
          minStockLevel:
            data.minStockLevel != null ? data.minStockLevel.toString() : null,
          photoKey: data.photoKey ?? null,
          notes: data.notes ?? null,
          linkedHppMaterialId: data.linkedHppMaterialId ?? null,
          linkedHppProductId: data.linkedHppProductId ?? null,
          autoSyncHppCost: data.autoSyncHppCost ?? true,
          // Smart default: ingredient inventory items (HPP-material
          // bridge, no recipe link) hide from POS by default. Admin
          // toggle on the form lets the bahan-baku-store edge case
          // override per item.
          isSellable:
            data.isSellable !== undefined
              ? data.isSellable
              : !(data.linkedHppMaterialId && !data.linkedHppProductId),
          isBookable: data.isBookable ?? false,
          bookingColor: data.bookingColor ?? null,
          bookingDurationMin: data.bookingDurationMin ?? null,
          // prep_mode only meaningful with a recipe link. DB CHECK
          // also rejects mismatches, but we silently clamp here so a
          // form that left prep_mode=true with no recipe doesn't 500.
          prepMode: data.prepMode === true && data.linkedHppProductId
            ? true
            : false,
          isFavorite: data.isFavorite ?? false,
          isOnline: data.isOnline ?? false,
          shippingWeightGrams: data.shippingWeightGrams ?? null,
          onlineStockCap:
            data.onlineStockCap != null
              ? data.onlineStockCap.toString()
              : null,
        })
        .returning()

      // Seed the base unit row in inventory_item_units so subsequent
      // pricing setup + cashier queries always find at least one unit.
      // The base unit also doubles as the initial "default sale unit"
      // (admin can re-pick later via setDefaultUnit).
      await tx.insert(inventoryItemUnits).values({
        tenantId: auth.tenantId,
        itemId: item!.id,
        unitId: data.baseUnitId,
        ratioToBase: '1',
        sortOrder: 0,
        isDefault: true,
      })

      // If admin entered an initial selling price, seed the base unit's
      // tier-1 row so the item is immediately sellable in POS.
      if (data.initialSellingPrice != null && data.initialSellingPrice >= 0) {
        await tx.insert(inventoryItemUnitPricing).values({
          tenantId: auth.tenantId,
          itemId: item!.id,
          unitId: data.baseUnitId,
          minQty: '1',
          unitPrice: data.initialSellingPrice.toString(),
          sortOrder: 0,
        })
      }

      return item
    })
    return row
  })

// ─── Bulk import from HPP ──────────────────────────────────────────

/**
 * Candidates for the bulk HPP → inventory import page. Returns every
 * HPP material and product, each flagged `alreadyImported` when an
 * active inventory item already links back to it, plus the unit list
 * and the tenant's SKU quota so the page can guard before saving.
 */
export const getHppImportCandidates = createServerFn().handler(async () => {
  const auth = await requireInventoryAccess()
  const limits = inventoryTierLimits(auth.inventoryTier)

  const [linkedRows, mats, prods, units, countRow] = await Promise.all([
    db
      .select({
        mat: inventoryItems.linkedHppMaterialId,
        prod: inventoryItems.linkedHppProductId,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.isActive, true),
        ),
      ),
    db
      .select({
        id: materials.id,
        name: materials.name,
        brand: materials.brand,
        unitId: materials.unitId,
        unitLabel: masterHppUnits.label,
        pricePerUnit: materials.pricePerUnit,
      })
      .from(materials)
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, materials.unitId))
      .where(eq(materials.tenantId, auth.tenantId))
      .orderBy(materials.name),
    db
      .select({
        id: products.id,
        name: products.name,
        category: products.category,
        sellingPrice: products.sellingPrice,
        hpp: products.hpp,
      })
      .from(products)
      .where(eq(products.tenantId, auth.tenantId))
      .orderBy(products.name),
    db
      .select({
        id: masterHppUnits.id,
        value: masterHppUnits.value,
        label: masterHppUnits.label,
      })
      .from(masterHppUnits)
      .where(eq(masterHppUnits.isActive, true))
      .orderBy(masterHppUnits.sortOrder),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.isActive, true),
        ),
      ),
  ])

  const linkedMat = new Set(
    linkedRows.map((r) => r.mat).filter((v): v is string => v != null),
  )
  const linkedProd = new Set(
    linkedRows.map((r) => r.prod).filter((v): v is string => v != null),
  )

  return {
    units,
    skuCap: limits.skuCap,
    skuCount: countRow[0]?.count ?? 0,
    materials: mats.map((m) => ({ ...m, alreadyImported: linkedMat.has(m.id) })),
    products: prods.map((p) => ({ ...p, alreadyImported: linkedProd.has(p.id) })),
  }
})

const bulkImportInput = z.object({
  source: z.enum(['material', 'product']),
  items: z
    .array(
      z.object({
        hppId: z.string().uuid(),
        /** Base unit. For materials the server overrides with the HPP
         *  material's own unit; for products this is the user's pick. */
        baseUnitId: z.string().uuid(),
        minStockLevel: z.coerce.number().min(0).optional().nullable(),
        isSellable: z.boolean(),
        isBookable: z.boolean(),
      }),
    )
    .min(1, 'Pilih minimal 1 item'),
})

/**
 * Create inventory items in bulk from HPP materials or products. Unit,
 * cost, and (for products) selling price are inherited from the HPP
 * side so the caller only supplies the few editable fields. Dedup is
 * re-checked here — anything linked since the page loaded is skipped,
 * not duplicated — and the SKU quota is enforced before any insert.
 */
export const bulkCreateInventoryItemsFromHpp = createServerFn({ method: 'POST' })
  .inputValidator(bulkImportInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    const limits = inventoryTierLimits(auth.inventoryTier)
    const hppIds = data.items.map((i) => i.hppId)

    // Dedup re-check: ids already linked to an active inventory item.
    const linkedRows = await db
      .select({
        mat: inventoryItems.linkedHppMaterialId,
        prod: inventoryItems.linkedHppProductId,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.isActive, true),
        ),
      )
    const alreadyLinked = new Set(
      linkedRows
        .map((r) => (data.source === 'material' ? r.mat : r.prod))
        .filter((v): v is string => v != null),
    )

    const matRows =
      data.source === 'material'
        ? await db
            .select({
              id: materials.id,
              name: materials.name,
              brand: materials.brand,
              unitId: materials.unitId,
              pricePerUnit: materials.pricePerUnit,
            })
            .from(materials)
            .where(
              and(
                eq(materials.tenantId, auth.tenantId),
                inArray(materials.id, hppIds),
              ),
            )
        : []
    const prodRows =
      data.source === 'product'
        ? await db
            .select({
              id: products.id,
              name: products.name,
              sellingPrice: products.sellingPrice,
              hpp: products.hpp,
            })
            .from(products)
            .where(
              and(
                eq(products.tenantId, auth.tenantId),
                inArray(products.id, hppIds),
              ),
            )
        : []
    const matById = new Map(matRows.map((m) => [m.id, m]))
    const prodById = new Map(prodRows.map((p) => [p.id, p]))

    const toCreate = data.items.filter((i) => {
      if (alreadyLinked.has(i.hppId)) return false
      return data.source === 'material'
        ? matById.has(i.hppId)
        : prodById.has(i.hppId)
    })
    const skipped = data.items.length - toCreate.length
    if (toCreate.length === 0) return { created: 0, skipped }

    if (limits.skuCap != null) {
      const [cnt] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.tenantId, auth.tenantId),
            eq(inventoryItems.isActive, true),
          ),
        )
      const current = cnt?.count ?? 0
      if (current + toCreate.length > limits.skuCap) {
        throw new Error(
          `Melebihi batas SKU (${current}/${limits.skuCap}). Pilih lebih sedikit item atau upgrade paket.`,
        )
      }
    }

    await db.transaction(async (tx) => {
      for (const draft of toCreate) {
        const isBookable = draft.isBookable && draft.isSellable
        let name: string
        let brand: string | null = null
        let baseUnitId: string
        let costPrice = 0
        let sellingPrice: number | null = null
        let linkedHppMaterialId: string | null = null
        let linkedHppProductId: string | null = null

        if (data.source === 'material') {
          const m = matById.get(draft.hppId)!
          name = m.name
          brand = m.brand
          // Unit is authoritative from the HPP material — keeps the
          // base-unit ↔ HPP-unit invariant assertHppUnitMatchesBase
          // guards on the single-create path.
          baseUnitId = m.unitId
          costPrice = Number(m.pricePerUnit)
          linkedHppMaterialId = m.id
        } else {
          const p = prodById.get(draft.hppId)!
          name = p.name
          baseUnitId = draft.baseUnitId
          costPrice = p.hpp != null ? Number(p.hpp) : 0
          // Seed the HPP selling price so a POS-visible product isn't
          // listed at Rp 0.
          sellingPrice = draft.isSellable ? Number(p.sellingPrice) : null
          linkedHppProductId = p.id
        }

        const [item] = await tx
          .insert(inventoryItems)
          .values({
            tenantId: auth.tenantId,
            name,
            brand,
            baseUnitId,
            costPrice: costPrice.toString(),
            minStockLevel:
              draft.minStockLevel != null
                ? draft.minStockLevel.toString()
                : null,
            linkedHppMaterialId,
            linkedHppProductId,
            isSellable: draft.isSellable,
            isBookable,
          })
          .returning()

        await tx.insert(inventoryItemUnits).values({
          tenantId: auth.tenantId,
          itemId: item!.id,
          unitId: baseUnitId,
          ratioToBase: '1',
          sortOrder: 0,
          isDefault: true,
        })

        if (sellingPrice != null && sellingPrice >= 0) {
          await tx.insert(inventoryItemUnitPricing).values({
            tenantId: auth.tenantId,
            itemId: item!.id,
            unitId: baseUnitId,
            minQty: '1',
            unitPrice: sellingPrice.toString(),
            sortOrder: 0,
          })
        }
      }
    })

    return { created: toCreate.length, skipped }
  })

export const updateInventoryItem = createServerFn({ method: 'POST' })
  .inputValidator(itemInput.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    const { id, ...updates } = data

    if (updates.linkedHppMaterialId) {
      await assertHppUnitMatchesBase(
        updates.baseUnitId,
        updates.linkedHppMaterialId,
      )
    }

    // updateInventoryItem touches item-level fields only. Pricing tiers
    // and unit setup are managed via setInventoryItemUnits + the tier
    // mutations below — keeps the surface focused.
    const [row] = await db
      .update(inventoryItems)
      .set({
        name: updates.name,
        sku: updates.sku?.trim() || null,
        brand: updates.brand?.trim() || null,
        categoryId: updates.categoryId ?? null,
        baseUnitId: updates.baseUnitId,
        costPrice: updates.costPrice.toString(),
        franchisePrice:
          updates.franchisePrice != null
            ? updates.franchisePrice.toString()
            : null,
        minStockLevel:
          updates.minStockLevel != null
            ? updates.minStockLevel.toString()
            : null,
        // Photo is managed by uploadInventoryItemPhotoFn /
        // removeInventoryItemPhoto, which the edit form only calls when
        // the user actually touches it. The form never sends photoKey
        // here, so writing `updates.photoKey ?? null` unconditionally
        // would wipe an existing photo on every metadata edit. Only
        // touch photoKey when it's explicitly provided.
        ...(updates.photoKey !== undefined
          ? { photoKey: updates.photoKey }
          : {}),
        notes: updates.notes ?? null,
        linkedHppMaterialId: updates.linkedHppMaterialId ?? null,
        linkedHppProductId: updates.linkedHppProductId ?? null,
        autoSyncHppCost: updates.autoSyncHppCost ?? true,
        // Edits respect explicit user choice; absence leaves the
        // existing value alone (no smart-default on update — the
        // user might have toggled this and we mustn't undo it).
        ...(updates.isSellable !== undefined
          ? { isSellable: updates.isSellable }
          : {}),
        ...(updates.isBookable !== undefined
          ? { isBookable: updates.isBookable }
          : {}),
        ...(updates.bookingColor !== undefined
          ? { bookingColor: updates.bookingColor }
          : {}),
        ...(updates.bookingDurationMin !== undefined
          ? { bookingDurationMin: updates.bookingDurationMin }
          : {}),
        // Force prep_mode off when the recipe link was cleared in the
        // same update — keeps the CHECK constraint happy and avoids a
        // confusing "prep mode on, no recipe" state.
        ...(updates.prepMode !== undefined
          ? {
              prepMode:
                updates.prepMode === true && updates.linkedHppProductId
                  ? true
                  : false,
            }
          : {}),
        ...(updates.isFavorite !== undefined
          ? { isFavorite: updates.isFavorite }
          : {}),
        ...(updates.isOnline !== undefined
          ? { isOnline: updates.isOnline }
          : {}),
        ...(updates.shippingWeightGrams !== undefined
          ? { shippingWeightGrams: updates.shippingWeightGrams ?? null }
          : {}),
        ...(updates.onlineStockCap !== undefined
          ? {
              onlineStockCap:
                updates.onlineStockCap != null
                  ? updates.onlineStockCap.toString()
                  : null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryItems.id, id),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .returning()
    if (!row) throw new Error('Item tidak ditemukan')

    // Make sure the base-unit row exists in inventory_item_units (for
    // items that pre-date this feature, or where the base unit changed).
    // We don't toggle isDefault here — that's an explicit user action
    // via setDefaultUnit. Newly-created base-unit rows default to false
    // here; the auto-seed in createInventoryItem flips it to true on
    // first creation.
    await db
      .insert(inventoryItemUnits)
      .values({
        tenantId: auth.tenantId,
        itemId: id,
        unitId: updates.baseUnitId,
        ratioToBase: '1',
        sortOrder: 0,
      })
      .onConflictDoNothing({
        target: [inventoryItemUnits.itemId, inventoryItemUnits.unitId],
      })

    return row
  })

export const deactivateInventoryItem = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    await db
      .update(inventoryItems)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryItems.id, data.id),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
    return { ok: true }
  })

/**
 * One-field toggle for the "Favorit" flag. Pulls the favoriting
 * affordance off the full edit form so the cashier-pinning workflow
 * is one tap on the item detail page (and so we can wire it as a
 * star button without yanking the user through the whole edit sheet).
 */
export const setInventoryItemFavorite = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ id: z.string().uuid(), isFavorite: z.boolean() }),
  )
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    const [row] = await db
      .update(inventoryItems)
      .set({ isFavorite: data.isFavorite, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryItems.id, data.id),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .returning({ id: inventoryItems.id, isFavorite: inventoryItems.isFavorite })
    if (!row) throw new Error('Item tidak ditemukan')
    return row
  })

/**
 * Hard delete — only allowed when there is NO history attached
 * (zero movements, zero balances, zero PO lines). Mistakes-only path.
 * Anything with history must use deactivateInventoryItem so the
 * audit trail stays intact. Movements/balances/conversions cascade
 * via FK, but we still refuse so users don't accidentally nuke
 * historical records.
 */
export const deleteInventoryItem = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    // Confirm ownership before any reference checks. We also pull
    // photoKey here so we can clean the S3 object after the row is
    // gone — deactivate keeps the photo, only hard-delete removes it.
    const [item] = await db
      .select({ id: inventoryItems.id, photoKey: inventoryItems.photoKey })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.id),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan')

    const [movRow] = await db
      .select({ movements: sql<number>`count(*)::int` })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.itemId, data.id))
    const [balRow] = await db
      .select({ balances: sql<number>`count(*)::int` })
      .from(inventoryStockBalances)
      .where(eq(inventoryStockBalances.itemId, data.id))
    const [poRow] = await db
      .select({ poLines: sql<number>`count(*)::int` })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.itemId, data.id))

    const movements = movRow?.movements ?? 0
    const balances = balRow?.balances ?? 0
    const poLines = poRow?.poLines ?? 0
    if (movements > 0 || balances > 0 || poLines > 0) {
      throw new Error(
        'Item ini sudah punya riwayat pergerakan atau saldo. Gunakan "Nonaktifkan" untuk menyembunyikannya tanpa menghapus riwayat.',
      )
    }

    await db
      .delete(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.id),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )

    // Best-effort S3 cleanup. If the delete fails (object already
    // gone, IAM hiccup) we don't want to throw — the DB row is the
    // source of truth and it's already removed.
    if (item.photoKey) {
      try {
        await deleteInventoryPhoto(item.photoKey)
      } catch {
        // swallow — orphaned S3 object is a small leak, not a bug
      }
    }

    return { ok: true }
  })

// ─── Photo upload / display ──────────────────────────────────────────

/**
 * Upload (or replace) the photo for an inventory item. Client compresses
 * to ~800px JPEG before calling — server enforces the 500 KB ceiling
 * defined by MAX_INVENTORY_PHOTO_BYTES so a misbehaving client can't
 * blow up our S3 bill.
 *
 * Re-uploading overwrites the previous object at the same key (the key
 * is `{tenantId}/inventory/{itemId}.{ext}`), so we don't accumulate
 * orphans for items with multiple edits.
 */
export const uploadInventoryItemPhotoFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      itemId: z.string().uuid(),
      photoDataUrl: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [item] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.itemId),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan')

    const { bytes, mimeType } = parseDataUrl(data.photoDataUrl)
    const { key } = await uploadInventoryItemPhoto({
      tenantId: auth.tenantId,
      itemId: data.itemId,
      bytes,
      mimeType,
    })

    await db
      .update(inventoryItems)
      .set({ photoKey: key, updatedAt: new Date() })
      .where(eq(inventoryItems.id, data.itemId))

    return { photoKey: key }
  })

/**
 * Delete the photo for an item without deleting the item itself.
 * Lets the user "remove photo" from the edit form.
 */
export const removeInventoryItemPhoto = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ itemId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [item] = await db
      .select({ photoKey: inventoryItems.photoKey })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.itemId),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan')

    if (item.photoKey) {
      try {
        await deleteInventoryPhoto(item.photoKey)
      } catch {
        // Swallow S3 error — DB update below is the source of truth.
      }
    }

    await db
      .update(inventoryItems)
      .set({ photoKey: null, updatedAt: new Date() })
      .where(eq(inventoryItems.id, data.itemId))

    return { ok: true }
  })

/**
 * Mints short-lived signed URLs for a batch of photo keys. The list
 * page calls this once with every visible item's key so we hit S3
 * presigner N times in parallel rather than N round-trips from the
 * client. 5-minute TTL — long enough for the page to render, short
 * enough that a leaked URL is harmless.
 */
export const getInventoryPhotoUrls = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ keys: z.array(z.string()).max(500) }))
  .handler(async ({ data }) => {
    await requireInventoryAccess()
    const entries = await Promise.all(
      data.keys.map(async (key) => {
        try {
          const url = await getInventoryPhotoSignedUrl(key, 300)
          return [key, url] as const
        } catch {
          return [key, null] as const
        }
      }),
    )
    return Object.fromEntries(entries) as Record<string, string | null>
  })

// ─── HPP downlink: apply material price to linked inventory items ───

/**
 * Returns the inventory items linked to a given HPP material so the
 * "Apply HPP price" banner can preview what would change. Includes
 * each item's current cost + autoSyncHppCost flag — the UI dims rows
 * with the toggle off so the user sees they're being skipped.
 */
export const previewLinkedItemsForMaterial = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ materialId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [material] = await db
      .select({
        id: materials.id,
        name: materials.name,
        pricePerUnit: materials.pricePerUnit,
        unit: masterHppUnits.value,
      })
      .from(materials)
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, materials.unitId))
      .where(
        and(
          eq(materials.id, data.materialId),
          eq(materials.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!material) throw new Error('Bahan HPP tidak ditemukan')

    const items = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        currentCost: inventoryItems.costPrice,
        autoSyncHppCost: inventoryItems.autoSyncHppCost,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.linkedHppMaterialId, data.materialId),
          eq(inventoryItems.isActive, true),
        ),
      )

    return {
      material: {
        id: material.id,
        name: material.name,
        unit: material.unit,
        pricePerUnit: Number(material.pricePerUnit),
      },
      items: items.map((it) => ({
        id: it.id,
        name: it.name,
        sku: it.sku,
        currentCost: Number(it.currentCost),
        autoSyncHppCost: it.autoSyncHppCost,
      })),
    }
  })

/**
 * Bulk-update linked inventory items' cost_price to match the HPP
 * material's current pricePerUnit. Respects the per-item
 * autoSyncHppCost toggle — items with the toggle off are skipped so
 * power users can opt out without losing the link.
 *
 * Idempotent: re-running with the same material yields no further
 * changes (everything already matches). Returns the count actually
 * updated so the UI can confirm "X item diperbarui."
 */
export const applyHppPriceToInventory = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ materialId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [material] = await db
      .select({ pricePerUnit: materials.pricePerUnit })
      .from(materials)
      .where(
        and(
          eq(materials.id, data.materialId),
          eq(materials.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!material) throw new Error('Bahan HPP tidak ditemukan')

    const result = await db
      .update(inventoryItems)
      .set({
        costPrice: material.pricePerUnit,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.linkedHppMaterialId, data.materialId),
          eq(inventoryItems.autoSyncHppCost, true),
          eq(inventoryItems.isActive, true),
        ),
      )
      .returning({ id: inventoryItems.id })

    return { updatedCount: result.length }
  })

// ─── Movements ───────────────────────────────────────────────────────

const movementInput = z.object({
  itemId: z.string().uuid(),
  branchId: z.string().uuid(),
  movementType: z.enum(['in', 'out', 'adjustment']),
  /** Quantity in the chosen unit. We convert to base unit when storing. */
  quantity: z.coerce.number().positive('Jumlah harus lebih dari 0'),
  /**
   * Unit ID for this movement. If omitted, the item's base unit is used.
   * Toko+: alt units allowed (must have a conversion row). Free: must
   * be the base unit.
   */
  unitId: z.string().uuid().optional(),
  unitCost: z.coerce.number().min(0).optional(),
  reason: z.string().max(50).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  /**
   * Source that triggered this movement. Defaults to 'manual' (cashier
   * UI). Other modules (POS sale, PO receive) pass their own source so
   * the movement is traceable back to the originating record. The
   * column has no enum constraint at the DB level — kept open for
   * future modules.
   */
  referenceType: z
    .enum(['manual', 'purchase_order', 'pos_sale'])
    .optional()
    .default('manual'),
  referenceId: z.string().uuid().optional(),
})

/**
 * Atomic movement recorder.
 *
 * 1. Validate input (unit conversion if alt unit chosen).
 * 2. Convert quantity to the item's base unit.
 * 3. Insert the movement row.
 * 4. Upsert stock_balances (creates row on first movement at this branch).
 * 5. If movement is 'in' AND item is linked to an HPP material AND
 *    unitCost was provided → update the linked HPP material's
 *    pricePerUnit to reflect the latest cost. (HPP sync uplink.)
 *
 * Steps 3 + 4 + 5 are wrapped in a single DB transaction.
 */
export const recordMovement = createServerFn({ method: 'POST' })
  .inputValidator(movementInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    // JUR-135: stock movements are branch-keyed — gate writes per the
    // member's pin set. No-op for owners + unrestricted callers.
    assertBranchAllowed(auth, data.branchId)

    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.itemId),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan')
    if (!item.isActive) throw new Error('Item sudah dinonaktifkan')
    // Service-mode (recipe-backed) items don't carry stock — sale path
    // walks the BOM to deduct ingredients. A manual stock-in / out / adj
    // would be silently disconnected from the model. Reject upstream so
    // the user sees why the form rejected it instead of writing dead
    // ledger rows.
    if (item.linkedHppProductId && data.referenceType !== 'pos_sale') {
      throw new Error(
        'Item resep tidak punya stok sendiri — stok bahan akan otomatis berkurang saat penjualan. Catat stok di bahan baku, bukan di sini.',
      )
    }

    // Free tier: only the main branch can carry stock movements. Paid
    // tiers bypass — they have unlimited branch access. Throws with a
    // friendly upgrade message when violated.
    await assertBranchAllowedForTier(
      auth.tenantId,
      auth.inventoryTier,
      data.branchId,
    )

    // Resolve unit + ratio. Default to base. The ratio is also used to
    // normalise unitCost into per-base-unit cost (e.g. user enters
    // "1 pcs at Rp 15.000" but HPP needs "Rp 15 / gram"). Without this,
    // the HPP sync downstream would store the wrong column units.
    let qtyInBase = data.quantity
    let baseRatio = 1
    if (data.unitId && data.unitId !== item.baseUnitId) {
      // Alt unit — Toko+ feature.
      assertFeatureAvailable(auth.inventoryTier, 'multi_unit')
      const [conv] = await db
        .select({ ratio: inventoryItemUnits.ratioToBase })
        .from(inventoryItemUnits)
        .where(
          and(
            eq(inventoryItemUnits.itemId, data.itemId),
            eq(inventoryItemUnits.unitId, data.unitId),
          ),
        )
        .limit(1)
      if (!conv) {
        throw new Error('Unit alternatif belum dikonfigurasi untuk item ini')
      }
      baseRatio = Number(conv.ratio)
      qtyInBase = data.quantity * baseRatio
    }
    // Per-base-unit cost. If user enters cost per alt unit (e.g. per pcs),
    // divide by ratio to get per-base-unit (e.g. per gram).
    const unitCostInBase =
      data.unitCost != null ? data.unitCost / baseRatio : null

    // Compute the balance delta. Adjustment is treated as absolute
    // delta (+ for increase, - for decrease) — but since `quantity` is
    // always positive and we don't have a separate sign field, the UI
    // sends two distinct movements ('in' or 'out') for adjustments.
    // 'adjustment' here means "manual correction" and is treated as
    // signed via the calling form (UI passes 'in' for +, 'out' for -).
    // Reserved for future use; today the form maps to 'in' / 'out'.
    const delta =
      data.movementType === 'in'
        ? qtyInBase
        : data.movementType === 'out'
          ? -qtyInBase
          : qtyInBase // adjustment: treat as absolute increase for MVP

    const performedAt = new Date()
    const result = await db.transaction(async (tx) => {
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          tenantId: auth.tenantId,
          itemId: data.itemId,
          branchId: data.branchId,
          movementType: data.movementType,
          quantity: qtyInBase.toString(),
          // Persist per-base-unit cost so the ledger is unit-consistent
          // even when the user entered cost per alt unit.
          unitCost: unitCostInBase != null ? unitCostInBase.toString() : null,
          reason: data.reason ?? null,
          referenceType: data.referenceType ?? 'manual',
          referenceId: data.referenceId ?? null,
          notes: data.notes ?? null,
          performedBy: auth.userId,
        })
        .returning()

      // Upsert balance: existing row +/- delta, else new row.
      const [existing] = await tx
        .select()
        .from(inventoryStockBalances)
        .where(
          and(
            eq(inventoryStockBalances.itemId, data.itemId),
            eq(inventoryStockBalances.branchId, data.branchId),
          ),
        )
        .limit(1)

      if (existing) {
        const newQty = Number(existing.quantity) + delta
        await tx
          .update(inventoryStockBalances)
          .set({
            quantity: newQty.toString(),
            lastMovementAt: performedAt,
            updatedAt: performedAt,
          })
          .where(eq(inventoryStockBalances.id, existing.id))
      } else {
        // First stock balance at this branch. The branch cap was already
        // enforced when the branch was created (see createInventoryBranch
        // → assertCanConsumeBranchSlot), so we don't re-check here —
        // any branch reachable via the picker is, by definition, a
        // legitimate tenant branch.
        await tx.insert(inventoryStockBalances).values({
          tenantId: auth.tenantId,
          itemId: data.itemId,
          branchId: data.branchId,
          quantity: delta.toString(),
          lastMovementAt: performedAt,
        })
      }

      // HPP sync uplink: when this is an 'in' movement on an HPP-linked
      // material AND the per-item auto-sync toggle is on, update the
      // material's pricePerUnit. Available on ALL tiers (free included)
      // — keeping HPP costs fresh is the main value of having both
      // modules. ALWAYS write per-base-unit cost, since the linked
      // material is required to share the item's base unit (enforced
      // by assertHppUnitMatchesBase on item save).
      if (
        data.movementType === 'in' &&
        unitCostInBase != null &&
        item.linkedHppMaterialId &&
        item.autoSyncHppCost
      ) {
        await tx
          .update(materials)
          .set({
            pricePerUnit: unitCostInBase.toString(),
            updatedAt: performedAt,
          })
          .where(eq(materials.id, item.linkedHppMaterialId))
      }

      // Mirror the new cost on the inventory item itself so the next
      // listing shows fresh stock value (also per-base-unit).
      if (data.movementType === 'in' && unitCostInBase != null) {
        await tx
          .update(inventoryItems)
          .set({
            costPrice: unitCostInBase.toString(),
            updatedAt: performedAt,
          })
          .where(eq(inventoryItems.id, data.itemId))
      }

      return movement
    })

    return result
  })

// ─── Bulk stock adjustment (opname) ──────────────────────────────────

/**
 * Data for the bulk stock-adjustment page: the tenant's branches, its
 * categories, and every active, non-recipe-backed item with its current
 * stock balance at the chosen branch (defaults to the main branch).
 * Recipe-backed items are excluded — they carry no own stock.
 */
export const getStockAdjustmentData = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ branchId: z.string().uuid().optional() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const rawBranches = await db
      .select({ id: branches.id, name: branches.name, isMain: branches.isMain })
      .from(branches)
      .where(
        and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)),
      )
      .orderBy(desc(branches.isMain), branches.name)
    const branchList = filterBranchesByAccess(auth, rawBranches)

    const branchId = data.branchId ?? branchList[0]?.id

    const categories = await db
      .select({ id: tenantCategories.id, name: tenantCategories.name })
      .from(tenantCategories)
      .where(eq(tenantCategories.tenantId, auth.tenantId))
      .orderBy(tenantCategories.sortOrder)

    const items = branchId
      ? await db
          .select({
            id: inventoryItems.id,
            name: inventoryItems.name,
            sku: inventoryItems.sku,
            categoryId: inventoryItems.categoryId,
            categoryName: tenantCategories.name,
            baseUnitLabel: masterHppUnits.label,
            linkedHppMaterialId: inventoryItems.linkedHppMaterialId,
            quantity: inventoryStockBalances.quantity,
          })
          .from(inventoryItems)
          .innerJoin(
            masterHppUnits,
            eq(masterHppUnits.id, inventoryItems.baseUnitId),
          )
          .leftJoin(
            tenantCategories,
            eq(tenantCategories.id, inventoryItems.categoryId),
          )
          .leftJoin(
            inventoryStockBalances,
            and(
              eq(inventoryStockBalances.itemId, inventoryItems.id),
              eq(inventoryStockBalances.branchId, branchId),
            ),
          )
          .where(
            and(
              eq(inventoryItems.tenantId, auth.tenantId),
              eq(inventoryItems.isActive, true),
              // Recipe-backed items have no own stock — sale-time BOM
              // walker deducts ingredients instead.
              isNull(inventoryItems.linkedHppProductId),
            ),
          )
          .orderBy(inventoryItems.name)
      : []

    return {
      branches: branchList,
      categories,
      branchId: branchId ?? null,
      items: items.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        type: r.linkedHppMaterialId
          ? ('bahan_baku' as const)
          : ('barang' as const),
        baseUnitLabel: r.baseUnitLabel,
        systemStock: r.quantity != null ? Number(r.quantity) : 0,
      })),
    }
  })

/**
 * Apply a batch of stock counts ("opname"). For each row the actual
 * counted quantity replaces the balance; the delta from the LIVE
 * balance (re-read here, not trusted from the page) is written as an
 * in/out movement tagged `reason: 'opname'`. Zero-delta and
 * recipe-backed rows are skipped.
 */
export const bulkRecordStockOpname = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      adjustments: z
        .array(
          z.object({
            itemId: z.string().uuid(),
            actualQty: z.coerce.number().min(0),
            note: z.string().max(500).optional().nullable(),
          }),
        )
        .min(1, 'Tidak ada penyesuaian'),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertBranchAllowed(auth, data.branchId)
    await assertBranchAllowedForTier(
      auth.tenantId,
      auth.inventoryTier,
      data.branchId,
    )

    const itemIds = data.adjustments.map((a) => a.itemId)
    const itemRows = await db
      .select({
        id: inventoryItems.id,
        linkedHppProductId: inventoryItems.linkedHppProductId,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.isActive, true),
          inArray(inventoryItems.id, itemIds),
        ),
      )
    // Only items that exist, are active, and aren't recipe-backed.
    const adjustable = new Set(
      itemRows.filter((i) => i.linkedHppProductId == null).map((i) => i.id),
    )

    const performedAt = new Date()
    let adjusted = 0
    let skipped = 0

    await db.transaction(async (tx) => {
      for (const adj of data.adjustments) {
        if (!adjustable.has(adj.itemId)) {
          skipped++
          continue
        }
        const [bal] = await tx
          .select()
          .from(inventoryStockBalances)
          .where(
            and(
              eq(inventoryStockBalances.itemId, adj.itemId),
              eq(inventoryStockBalances.branchId, data.branchId),
            ),
          )
          .limit(1)
        const current = bal ? Number(bal.quantity) : 0
        const delta = adj.actualQty - current
        if (delta === 0) {
          skipped++
          continue
        }

        await tx.insert(inventoryMovements).values({
          tenantId: auth.tenantId,
          itemId: adj.itemId,
          branchId: data.branchId,
          movementType: delta > 0 ? 'in' : 'out',
          quantity: Math.abs(delta).toString(),
          reason: 'opname',
          referenceType: 'manual',
          notes: adj.note?.trim() || null,
          performedBy: auth.userId,
        })

        if (bal) {
          await tx
            .update(inventoryStockBalances)
            .set({
              quantity: adj.actualQty.toString(),
              lastMovementAt: performedAt,
              updatedAt: performedAt,
            })
            .where(eq(inventoryStockBalances.id, bal.id))
        } else {
          await tx.insert(inventoryStockBalances).values({
            tenantId: auth.tenantId,
            itemId: adj.itemId,
            branchId: data.branchId,
            quantity: adj.actualQty.toString(),
            lastMovementAt: performedAt,
          })
        }
        adjusted++
      }
    })

    return { adjusted, skipped }
  })

/**
 * Delete a movement and reverse its effect on the stock balance.
 *
 * Safety constraints:
 *   - Refuses if the resulting balance would go negative — that means
 *     downstream movements (e.g. an out-stock) consumed this in-stock,
 *     and removing it would corrupt the ledger. User must record an
 *     adjustment instead.
 *   - Refuses movements created from a PO receipt (referenceType =
 *     'purchase_order') — those should be unwound via the PO itself
 *     to keep PO state consistent with stock state.
 *   - Does NOT revert HPP material price. The HPP sync stores only
 *     the most recent 'in' price; reverting requires walking the
 *     ledger to find the previous in-stock, which is more complex
 *     than Phase 1 needs. The next stock-in will refresh HPP correctly.
 */
export const deleteMovement = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [movement] = await db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.id, data.id),
          eq(inventoryMovements.tenantId, auth.tenantId),
          // JUR-135: 404-via-scope — restricted member can't even
          // see (or delete) movements in branches they don't manage.
          branchScopeWhere(auth, inventoryMovements.branchId),
        ),
      )
      .limit(1)
    if (!movement) throw new Error('Pergerakan tidak ditemukan')

    if (movement.referenceType === 'purchase_order') {
      throw new Error(
        'Pergerakan ini berasal dari Purchase Order. Batalkan/edit PO terkait untuk mengubah pergerakan.',
      )
    }

    const qty = Number(movement.quantity)
    const inverseDelta =
      movement.movementType === 'in'
        ? -qty
        : movement.movementType === 'out'
          ? qty
          : -qty // adjustment treated as +; reverse = −

    await db.transaction(async (tx) => {
      const [bal] = await tx
        .select()
        .from(inventoryStockBalances)
        .where(
          and(
            eq(inventoryStockBalances.itemId, movement.itemId),
            eq(inventoryStockBalances.branchId, movement.branchId),
          ),
        )
        .limit(1)
      if (!bal) throw new Error('Saldo cabang tidak ditemukan')

      const newQty = Number(bal.quantity) + inverseDelta
      if (newQty < 0) {
        throw new Error(
          `Tidak bisa hapus: saldo akan jadi negatif (${newQty}). Pergerakan setelahnya sudah mengurangi stok ini. Catat penyesuaian sebagai gantinya.`,
        )
      }

      await tx
        .update(inventoryStockBalances)
        .set({ quantity: newQty.toString(), updatedAt: new Date() })
        .where(eq(inventoryStockBalances.id, bal.id))

      await tx
        .delete(inventoryMovements)
        .where(eq(inventoryMovements.id, data.id))
    })

    return { ok: true }
  })

const listMovementsInput = z.object({
  itemId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
})

export const listInventoryMovements = createServerFn({ method: 'POST' })
  .inputValidator(listMovementsInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    const limits = inventoryTierLimits(auth.inventoryTier)

    // Free tier: clamp `from` to no older than (now - historyDays).
    const minFrom = limits.movementHistoryDays
      ? new Date(Date.now() - limits.movementHistoryDays * 24 * 60 * 60 * 1000)
      : null

    const conds = [eq(inventoryMovements.tenantId, auth.tenantId)]
    if (data.itemId) conds.push(eq(inventoryMovements.itemId, data.itemId))
    if (data.branchId) {
      // JUR-135: explicit branch filter — gate it. Throws fast so the
      // user gets a clear "akses dilarang" rather than a silent empty.
      assertBranchAllowed(auth, data.branchId)
      conds.push(eq(inventoryMovements.branchId, data.branchId))
    } else {
      // No explicit filter: scope to the member's allowed set.
      const scope = branchScopeWhere(auth, inventoryMovements.branchId)
      if (scope) conds.push(scope)
    }

    if (data.from) {
      const reqFrom = new Date(`${data.from}T00:00:00`)
      const effectiveFrom =
        minFrom && reqFrom < minFrom ? minFrom : reqFrom
      conds.push(gte(inventoryMovements.createdAt, effectiveFrom))
    } else if (minFrom) {
      conds.push(gte(inventoryMovements.createdAt, minFrom))
    }

    const offset = (data.page - 1) * data.pageSize
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: inventoryMovements.id,
          itemId: inventoryMovements.itemId,
          itemName: inventoryItems.name,
          branchId: inventoryMovements.branchId,
          branchName: branches.name,
          movementType: inventoryMovements.movementType,
          quantity: inventoryMovements.quantity,
          unitCost: inventoryMovements.unitCost,
          reason: inventoryMovements.reason,
          notes: inventoryMovements.notes,
          createdAt: inventoryMovements.createdAt,
        })
        .from(inventoryMovements)
        .innerJoin(
          inventoryItems,
          eq(inventoryMovements.itemId, inventoryItems.id),
        )
        .innerJoin(branches, eq(inventoryMovements.branchId, branches.id))
        .where(and(...conds))
        .orderBy(desc(inventoryMovements.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryMovements)
        .where(and(...conds)),
    ])

    return {
      items: rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        unitCost: r.unitCost ? Number(r.unitCost) : null,
      })),
      total: totalRow[0]?.count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      historyClampedToDays: limits.movementHistoryDays,
    }
  })

// ─── Unit conversions (Toko+) ────────────────────────────────────────

/**
 * Returns the units a movement form should offer for a given item:
 * the item's base unit plus any configured alt units. Used by the
 * stock-in / stock-out form's unit picker. Cheap, scoped to the
 * specific item — safe to call on every item-picker change.
 */
export const getItemMovementUnits = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ itemId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    const [item] = await db
      .select({
        id: inventoryItems.id,
        baseUnitId: inventoryItems.baseUnitId,
        baseUnitValue: masterHppUnits.value,
        baseUnitLabel: masterHppUnits.label,
        linkedHppMaterialId: inventoryItems.linkedHppMaterialId,
      })
      .from(inventoryItems)
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, inventoryItems.baseUnitId))
      .where(
        and(
          eq(inventoryItems.id, data.itemId),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan')

    const altUnits = await db
      .select({
        unitId: masterHppUnits.id,
        value: masterHppUnits.value,
        label: masterHppUnits.label,
        ratioToBase: inventoryItemUnits.ratioToBase,
      })
      .from(inventoryItemUnits)
      .innerJoin(
        masterHppUnits,
        eq(inventoryItemUnits.unitId, masterHppUnits.id),
      )
      .where(
        and(
          eq(inventoryItemUnits.itemId, data.itemId),
          // Exclude the base unit row (we already return baseUnit separately).
          sql`${inventoryItemUnits.unitId} <> ${item.baseUnitId}`,
        ),
      )
      .orderBy(masterHppUnits.sortOrder)

    return {
      baseUnit: {
        id: item.baseUnitId,
        value: item.baseUnitValue,
        label: item.baseUnitLabel,
      },
      altUnits: altUnits.map((u) => ({
        id: u.unitId,
        value: u.value,
        label: u.label,
        ratioToBase: Number(u.ratioToBase),
      })),
      hasHppLink: !!item.linkedHppMaterialId,
    }
  })

// ─── Unit + tier setup (Toko+) ───────────────────────────────────────
//
// `addItemUnit` adds an alt unit (gram → kg conversion). The base unit
// row is auto-seeded on item create — never created here.
//
// Pricing tiers go through addPricingTier / removePricingTier and are
// independent of unit setup; an item with a unit but no tiers won't
// appear in the cashier for that unit (it's "configured but not priced").
//
// Margin warnings (price < cost, price < cost*0.5) are computed
// CLIENT-side from the item's costPrice. Server doesn't gate; the
// admin can override with the "Saya tahu" checkbox in the UI.

export const addItemUnit = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      itemId: z.string().uuid(),
      unitId: z.string().uuid(),
      ratioToBase: z.coerce.number().positive('Rasio harus > 0'),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertFeatureAvailable(auth.inventoryTier, 'multi_unit')

    const [item] = await db
      .select({ baseUnitId: inventoryItems.baseUnitId })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.itemId),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan')
    if (item.baseUnitId === data.unitId && data.ratioToBase !== 1) {
      throw new Error('Unit dasar selalu memiliki rasio 1, tidak bisa diubah')
    }

    const [row] = await db
      .insert(inventoryItemUnits)
      .values({
        tenantId: auth.tenantId,
        itemId: data.itemId,
        unitId: data.unitId,
        ratioToBase: data.ratioToBase.toString(),
        sortOrder: 1,
      })
      .returning()
    return row
  })

export const removeItemUnit = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertFeatureAvailable(auth.inventoryTier, 'multi_unit')

    // Refuse if it's the base unit row — that's a structural invariant.
    const [row] = await db
      .select({
        itemId: inventoryItemUnits.itemId,
        unitId: inventoryItemUnits.unitId,
      })
      .from(inventoryItemUnits)
      .where(
        and(
          eq(inventoryItemUnits.id, data.id),
          eq(inventoryItemUnits.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Unit tidak ditemukan')

    const [item] = await db
      .select({ baseUnitId: inventoryItems.baseUnitId })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, row.itemId))
      .limit(1)
    if (item?.baseUnitId === row.unitId) {
      throw new Error('Unit dasar tidak bisa dihapus. Ubah unit dasar item dulu.')
    }

    // Cascading delete also wipes the unit's pricing tiers via the
    // (item_id, unit_id) tuple — but inventory_item_unit_pricing has no
    // FK on (item_id, unit_id) cascading from inventory_item_units. Do
    // it manually so the editor doesn't leak orphan tiers.
    await db.transaction(async (tx) => {
      await tx
        .delete(inventoryItemUnitPricing)
        .where(
          and(
            eq(inventoryItemUnitPricing.itemId, row.itemId),
            eq(inventoryItemUnitPricing.unitId, row.unitId),
          ),
        )
      await tx
        .delete(inventoryItemUnits)
        .where(eq(inventoryItemUnits.id, data.id))
    })
    return { ok: true }
  })

const tierInput = z.object({
  itemId: z.string().uuid(),
  unitId: z.string().uuid(),
  minQty: z.coerce.number().positive('Min qty harus > 0'),
  unitPrice: z.coerce.number().min(0),
})

export const upsertPricingTier = createServerFn({ method: 'POST' })
  .inputValidator(tierInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    // Sanity: the (item, unit) row must exist so we don't price a unit
    // the cashier can't actually pick.
    const [unitRow] = await db
      .select({ id: inventoryItemUnits.id })
      .from(inventoryItemUnits)
      .where(
        and(
          eq(inventoryItemUnits.itemId, data.itemId),
          eq(inventoryItemUnits.unitId, data.unitId),
        ),
      )
      .limit(1)
    if (!unitRow) {
      throw new Error('Unit ini belum dikonfigurasi untuk item ini')
    }

    await db
      .insert(inventoryItemUnitPricing)
      .values({
        tenantId: auth.tenantId,
        itemId: data.itemId,
        unitId: data.unitId,
        minQty: data.minQty.toString(),
        unitPrice: data.unitPrice.toString(),
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: [
          inventoryItemUnitPricing.itemId,
          inventoryItemUnitPricing.unitId,
          inventoryItemUnitPricing.minQty,
        ],
        set: {
          unitPrice: data.unitPrice.toString(),
          updatedAt: new Date(),
        },
      })
    return { ok: true }
  })

export const removePricingTier = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    await db
      .delete(inventoryItemUnitPricing)
      .where(
        and(
          eq(inventoryItemUnitPricing.id, data.id),
          eq(inventoryItemUnitPricing.tenantId, auth.tenantId),
        ),
      )
    return { ok: true }
  })

/**
 * Pick which unit shows on the cashier card for an item. Exactly one
 * row per (item) is `is_default = true`. We unset the previous default
 * THEN set the new one inside a transaction — order matters because
 * the partial unique index `inventory_item_units_one_default_per_item`
 * would otherwise reject the intermediate state.
 */
export const setDefaultUnit = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ itemId: z.string().uuid(), unitId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()

    // Sanity: the (item, unit) pair must exist for this tenant.
    const [target] = await db
      .select({ id: inventoryItemUnits.id })
      .from(inventoryItemUnits)
      .where(
        and(
          eq(inventoryItemUnits.tenantId, auth.tenantId),
          eq(inventoryItemUnits.itemId, data.itemId),
          eq(inventoryItemUnits.unitId, data.unitId),
        ),
      )
      .limit(1)
    if (!target) {
      throw new Error('Unit ini belum dikonfigurasi untuk item ini')
    }

    await db.transaction(async (tx) => {
      await tx
        .update(inventoryItemUnits)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryItemUnits.itemId, data.itemId),
            eq(inventoryItemUnits.isDefault, true),
          ),
        )
      await tx
        .update(inventoryItemUnits)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(inventoryItemUnits.id, target.id))
    })

    return { ok: true }
  })

// ─── Branches ────────────────────────────────────────────────────────

export const listInventoryBranches = createServerFn().handler(async () => {
  const auth = await requireInventoryAccess()
  const limits = inventoryTierLimits(auth.inventoryTier)

  const rawBranches = await db
    .select({
      id: branches.id,
      name: branches.name,
      address: branches.address,
      isActive: branches.isActive,
    })
    .from(branches)
    .where(and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)))
    .orderBy(branches.name)
  // JUR-135: restricted members see only the branches they can act on.
  const allBranches = filterBranchesByAccess(auth, rawBranches)

  // Per-branch totals for inventory.
  const totals = await db.execute<{ branch_id: string; total_value: string }>(sql`
    SELECT b.id AS branch_id,
           COALESCE(SUM(sb.quantity * i.cost_price), 0) AS total_value
    FROM branches b
    LEFT JOIN inventory_stock_balances sb ON sb.branch_id = b.id
    LEFT JOIN inventory_items i ON i.id = sb.item_id AND i.is_active = true
    WHERE b.tenant_id = ${auth.tenantId} AND b.is_active = true
    GROUP BY b.id
  `)
  const valueByBranch = new Map(
    totals.map((t) => [t.branch_id, Number(t.total_value)]),
  )

  const branchesUsed = await countInventoryBranches(auth.tenantId)

  return {
    branches: allBranches.map((b) => ({
      ...b,
      stockValueIdr: valueByBranch.get(b.id) ?? 0,
    })),
    branchCap: limits.branchCap,
    branchesUsed,
    canAdd:
      limits.branchCap == null || branchesUsed < limits.branchCap,
  }
})

export const createInventoryBranch = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1, 'Nama cabang wajib diisi').max(100),
      address: z.string().max(500).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    await assertCanConsumeBranchSlot(auth.tenantId, auth.inventoryTier)

    // Inventory branches use the shared `branches` table. Coordinates
    // are required by the schema (NOT NULL); for inventory-only
    // branches we default to 0,0 + 100m radius — the user can edit
    // these later when wiring the same branch to attendance.
    const [row] = await db
      .insert(branches)
      .values({
        tenantId: auth.tenantId,
        name: data.name,
        address: data.address ?? null,
        latitude: '0',
        longitude: '0',
        radiusMeters: 100,
        isActive: true,
      })
      .returning()
    return row
  })

// ─── Master data passthroughs (for forms) ────────────────────────────

/**
 * One-shot loader for everything an inventory form needs: units,
 * categories, branches, suppliers, HPP materials. Lets the client
 * do a single round-trip instead of fanning out 5 separate queries.
 */
export const listInventoryFormMasters = createServerFn().handler(async () => {
  const auth = await requireInventoryAccess()
  const [units, categories, allBranches, supplierList, hppMaterials, hppProducts] =
    await Promise.all([
      db
        .select({
          id: masterHppUnits.id,
          value: masterHppUnits.value,
          label: masterHppUnits.label,
        })
        .from(masterHppUnits)
        .where(eq(masterHppUnits.isActive, true))
        .orderBy(masterHppUnits.sortOrder),
      db
        .select({ id: tenantCategories.id, name: tenantCategories.name })
        .from(tenantCategories)
        .where(eq(tenantCategories.tenantId, auth.tenantId))
        .orderBy(tenantCategories.sortOrder),
      db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, auth.tenantId),
            eq(branches.isActive, true),
          ),
        )
        .orderBy(branches.name),
      db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.tenantId, auth.tenantId))
        .orderBy(suppliers.name),
      db
        .select({
          id: materials.id,
          name: materials.name,
          unit: masterHppUnits.value,
          brand: materials.brand,
          // pricePerUnit returned so the inventory form can auto-fill
          // Harga Pokok the moment the user picks a Bahan baku link
          // — no need to retype a value that already lives on the
          // HPP material.
          pricePerUnit: materials.pricePerUnit,
        })
        .from(materials)
        .innerJoin(masterHppUnits, eq(masterHppUnits.id, materials.unitId))
        .where(eq(materials.tenantId, auth.tenantId))
        .orderBy(materials.name),
      // HPP products + a per-row recipe count. The count is what tells
      // the inventory form whether picking the product as a Sumber HPP
      // will actually drive auto-deduct on POS sales (JUR-10) or just
      // attach a name. LEFT JOIN + GROUP BY because earlier the
      // correlated-subquery shape was returning 0 even when the rows
      // were present — postgres-js + drizzle interpolation didn't
      // hand back a proper int. The COALESCE keeps recipe-less
      // products in the list with count 0.
      db
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          // Fields surfaced so the inventory form can auto-fill its
          // sister fields when the user picks "Produk jadi":
          //   productionUnit → Unit Dasar
          //   category       → Kategori (text → tenant_categories.id mapping in the form)
          //   sellingPrice   → Harga Jual Awal
          //   hpp            → Harga Pokok (BOM-derived)
          //   photoKey       → Foto (fetched as a data URL on link-pick
          //                    so a fresh copy lands on the inventory
          //                    item — independent S3 lifecycle)
          productionUnit: products.productionUnit,
          category: products.category,
          sellingPrice: products.sellingPrice,
          hpp: products.hpp,
          photoKey: products.photoKey,
          ingredientCount: sql<number>`COALESCE(COUNT(${productMaterials.id})::int, 0)`,
        })
        .from(products)
        .leftJoin(
          productMaterials,
          eq(productMaterials.productId, products.id),
        )
        .where(eq(products.tenantId, auth.tenantId))
        .groupBy(
          products.id,
          products.name,
          products.sku,
          products.productionUnit,
          products.category,
          products.sellingPrice,
          products.hpp,
          products.photoKey,
        )
        .orderBy(products.name),
    ])

  // Free tier sees only its main branch in the picker — paid tiers
  // see every branch the tenant has. The dashboard widget is the
  // only place where Free users can change which branch is "main".
  let branchList = allBranches
  if (auth.inventoryTier === 'free') {
    const mainBranchId = await ensureMainBranchId(auth.tenantId)
    branchList = mainBranchId
      ? allBranches.filter((b) => b.id === mainBranchId)
      : []
  }

  return {
    units,
    categories,
    branches: branchList,
    suppliers: supplierList,
    hppMaterials,
    hppProducts,
  }
})
