import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import {
  suppliers,
  materials,
  products,
  productMaterials,
  overheadCosts,
  tenantCategories,
  inventoryItems,
  masterHppUnits,
} from '@vintra/db/schema'
import { eq, and, ilike, sql, inArray, isNotNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { requireAuth } from '../middleware/auth'
import { createNotification } from '../notifications'
import { NOTIFICATION_TYPES } from '@vintra/shared'
import {
  uploadHppProductPhoto,
  getHppProductPhotoSignedUrl,
  deleteHppProductPhoto,
  parseDataUrl,
} from '@/lib/s3-storage'
import {
  createSupplierSchema,
  updateSupplierSchema,
  createMaterialSchema,
  updateMaterialSchema,
  createProductSchema,
  updateProductSchema,
  createProductMaterialSchema,
  updateProductMaterialSchema,
  createOverheadSchema,
  updateOverheadSchema,
  createCategorySchema,
  updateCategorySchema,
} from '@vintra/shared'
import { z } from 'zod'
import {
  calculateMaterialCost,
  calculateMargin,
  perUnitHpp,
  bomRowUnitPrice,
} from '@/lib/hpp-calculator'
import { computeTenantHpp } from '../lib/hpp-engine-load'
import {
  recalcTenantHpp,
  previewMaterialPriceChange,
  summarizeImpact,
} from '../lib/hpp-cascade'

// ─── Tenant Categories ───────────────────────────────

export const getTenantCategories = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()
  return db
    .select()
    .from(tenantCategories)
    .where(eq(tenantCategories.tenantId, tenantId))
    .orderBy(tenantCategories.sortOrder)
})

export const createTenantCategory = createServerFn({ method: 'POST' })
  .inputValidator(createCategorySchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [category] = await db
      .insert(tenantCategories)
      .values({
        name: data.name,
        sortOrder: data.sortOrder ?? 0,
        isVisibleOnSitus: data.isVisibleOnSitus ?? true,
        tenantId,
      })
      .returning()
    return category!
  })

export const updateTenantCategory = createServerFn({ method: 'POST' })
  .inputValidator(updateCategorySchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const { id, ...updates } = data
    const [category] = await db
      .update(tenantCategories)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(eq(tenantCategories.id, id), eq(tenantCategories.tenantId, tenantId)),
      )
      .returning()
    if (!category) throw new Error('Kategori tidak ditemukan')
    return category
  })

export const deleteTenantCategory = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(tenantCategories)
      .where(
        and(eq(tenantCategories.id, data.id), eq(tenantCategories.tenantId, tenantId)),
      )
    return { success: true }
  })

// ─── Suppliers ────────────────────────────────────────

export const getSuppliers = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()
  return db
    .select()
    .from(suppliers)
    .where(eq(suppliers.tenantId, tenantId))
    .orderBy(suppliers.name)
})

export const getSupplier = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const result = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, data.id), eq(suppliers.tenantId, tenantId)))
      .limit(1)
    if (result.length === 0) throw new Error('Supplier tidak ditemukan')
    return result[0]!
  })

export const createSupplier = createServerFn({ method: 'POST' })
  .inputValidator(createSupplierSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [supplier] = await db
      .insert(suppliers)
      .values({ ...data, tenantId })
      .returning()
    return supplier!
  })

export const updateSupplier = createServerFn({ method: 'POST' })
  .inputValidator(updateSupplierSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const { id, ...updates } = data
    const [supplier] = await db
      .update(suppliers)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)))
      .returning()
    if (!supplier) throw new Error('Supplier tidak ditemukan')
    return supplier
  })

export const deleteSupplier = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(suppliers)
      .where(and(eq(suppliers.id, data.id), eq(suppliers.tenantId, tenantId)))
    return { success: true }
  })

export const findOrCreateSupplier = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    // Case-insensitive match
    const existing = await db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.tenantId, tenantId),
          ilike(suppliers.name, data.name),
        ),
      )
      .limit(1)
    if (existing.length > 0) return existing[0]!
    const [created] = await db
      .insert(suppliers)
      .values({ name: data.name, tenantId })
      .returning()
    return created!
  })

// ─── Materials ─────────────────────────────────────────

export const getMaterials = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()
  // JUR-14: unit comes from join on master_hpp_units. We return both
  // `unitId` (FK, used by edit forms) and `unit` (master `value`,
  // legacy display key callers use as the unit identifier in plain
  // text — e.g. "gram"). Together they're enough for any UI surface
  // without a follow-up roundtrip.
  return db
    .select({
      id: materials.id,
      tenantId: materials.tenantId,
      name: materials.name,
      brand: materials.brand,
      unitId: materials.unitId,
      unit: masterHppUnits.value,
      unitLabel: masterHppUnits.label,
      pricePerUnit: materials.pricePerUnit,
      purchasePrice: materials.purchasePrice,
      purchaseQty: materials.purchaseQty,
      supplierId: materials.supplierId,
      supplierName: suppliers.name,
      notes: materials.notes,
      createdAt: materials.createdAt,
      updatedAt: materials.updatedAt,
    })
    .from(materials)
    .innerJoin(masterHppUnits, eq(masterHppUnits.id, materials.unitId))
    .leftJoin(suppliers, eq(materials.supplierId, suppliers.id))
    .where(eq(materials.tenantId, tenantId))
    .orderBy(materials.name)
})

export const getMaterial = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const result = await db
      .select()
      .from(materials)
      .where(and(eq(materials.id, data.id), eq(materials.tenantId, tenantId)))
      .limit(1)
    if (result.length === 0) throw new Error('Bahan baku tidak ditemukan')
    return result[0]!
  })

export const createMaterial = createServerFn({ method: 'POST' })
  .inputValidator(createMaterialSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const { supplierId, purchasePrice, purchaseQty, ...rest } = data
    const pp = Number(purchasePrice)
    const pq = Number(purchaseQty)
    const pricePerUnit = pq > 0 ? (pp / pq).toFixed(2) : '0'
    const [material] = await db
      .insert(materials)
      .values({
        ...rest,
        pricePerUnit,
        purchasePrice,
        purchaseQty,
        supplierId: supplierId || null,
        tenantId,
      })
      .returning()
    if (!material) throw new Error('Gagal membuat bahan baku')
    // Resolve unit text via the master units row so callers (HPP
    // step-2 form, supplier page) can write the unit back to their
    // form state without an extra round-trip.
    const [unitRow] = await db
      .select({ value: masterHppUnits.value, label: masterHppUnits.label })
      .from(masterHppUnits)
      .where(eq(masterHppUnits.id, material.unitId))
      .limit(1)
    return {
      ...material,
      unit: unitRow?.value ?? '',
      unitLabel: unitRow?.label ?? '',
    }
  })

export const updateMaterial = createServerFn({ method: 'POST' })
  .inputValidator(updateMaterialSchema)
  .handler(async ({ data }) => {
    const { userId, tenantId } = await requireAuth()
    const { id, supplierId, purchasePrice, purchaseQty, ...updates } = data

    // Snapshot the previous price BEFORE the update so we can detect
    // a real change and emit the inventory downlink notification.
    // Skipping this when nothing about the price moved keeps us from
    // spamming users on cosmetic edits (renaming, supplier change, etc).
    const [before] = await db
      .select({
        pricePerUnit: materials.pricePerUnit,
        name: materials.name,
        // JUR-14: unit text is gone — read the master value via join.
        unit: masterHppUnits.value,
      })
      .from(materials)
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, materials.unitId))
      .where(and(eq(materials.id, id), eq(materials.tenantId, tenantId)))
      .limit(1)
    if (!before) throw new Error('Bahan baku tidak ditemukan')

    // Recalculate pricePerUnit when purchase fields are provided
    const pricePerUnitUpdate: Record<string, string> = {}
    if (purchasePrice !== undefined && purchaseQty !== undefined) {
      const pp = Number(purchasePrice)
      const pq = Number(purchaseQty)
      pricePerUnitUpdate.pricePerUnit = pq > 0 ? (pp / pq).toFixed(2) : '0'
    }

    // The price write and the cascade it triggers share one transaction, so an
    // ingredient price can never be committed while the HPP derived from it is
    // not — that drift is exactly what this mechanism exists to prevent. `tx`
    // is threaded down for the same reason: reading through the root client
    // would recompute from the price as it was BEFORE this update.
    const { material, cascade } = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(materials)
        .set({
          ...updates,
          ...pricePerUnitUpdate,
          ...(purchasePrice !== undefined ? { purchasePrice } : {}),
          ...(purchaseQty !== undefined ? { purchaseQty } : {}),
          ...(supplierId !== undefined ? { supplierId: supplierId || null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(materials.id, id), eq(materials.tenantId, tenantId)))
        .returning()
      if (!updated) throw new Error('Bahan baku tidak ditemukan')

      // Only when the price actually moved. Renaming an ingredient or
      // changing its supplier must not churn every product's `updatedAt` or
      // write no-op rows into the price history.
      const priceMoved =
        Math.round(Number(before.pricePerUnit) * 100) !==
        Math.round(Number(updated.pricePerUnit) * 100)

      const recalc = priceMoved
        ? await recalcTenantHpp(tenantId, tx, {
            reason: 'material_price',
            materialId: id,
          })
        : null

      return { material: updated, cascade: recalc }
    })

    // HPP downlink: if the price actually changed and there are linked
    // inventory items still expecting auto-sync, fire a notification
    // so the tenant can apply the new cost in one click. Best-effort:
    // any failure here doesn't block the material update itself.
    try {
      const oldPrice = Number(before.pricePerUnit)
      const newPrice = Number(material.pricePerUnit)
      if (Number.isFinite(oldPrice) && Number.isFinite(newPrice) && oldPrice !== newPrice) {
        const [linkedRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.tenantId, tenantId),
              eq(inventoryItems.linkedHppMaterialId, material.id),
              eq(inventoryItems.autoSyncHppCost, true),
              eq(inventoryItems.isActive, true),
            ),
          )
        const linkedCount = linkedRow?.count ?? 0
        if (linkedCount > 0) {
          // Notify the user who edited the material — they're already
          // looking at the screen. Multi-user tenants would benefit
          // from notifying all members with `inventory.manage`, but
          // that broadcast can land in a follow-up; the per-user
          // notification covers the common single-owner case.
          await createNotification({
            userId,
            tenantId,
            type: NOTIFICATION_TYPES.inventoryHppCostChanged,
            title: 'Harga HPP berubah',
            body: `Harga "${material.name}" berubah dari Rp ${oldPrice.toLocaleString('id-ID')} ke Rp ${newPrice.toLocaleString('id-ID')}/${before.unit}. ${linkedCount} item inventory tertaut — terapkan harga baru?`,
            url: `/inventory/items?applyHpp=${material.id}`,
            data: {
              materialId: material.id,
              oldPrice,
              newPrice,
              linkedCount,
            },
            // Idempotency: dedupe within the same minute so a quick
            // double-save doesn't spam two notifications.
            sourceKey: `inventory-hpp-changed-${material.id}-${Math.floor(
              Date.now() / 60000,
            )}`,
          })
        }
      }
    } catch (err) {
      console.error('[updateMaterial] failed to emit HPP downlink notif', err)
    }

    // Return what the cascade did alongside the material, so the form can
    // report "12 produk ikut diperbarui" instead of leaving the owner to
    // wonder whether their price edit reached anything.
    return {
      ...material,
      hppCascade: cascade
        ? { ...summarizeImpact(cascade), products: cascade.changed }
        : null,
    }
  })

/**
 * What would changing this ingredient's price do to the catalog?
 *
 * Read-only — nothing is written. The material edit form calls this before
 * saving so the owner sees the consequences of the number they typed while
 * they can still change their mind: how many products move, by how much, and
 * which ones would end up selling under a healthy margin.
 *
 * A manual edit asks; a stock-in does not. The person typing a new ingredient
 * price is the person who sets menu prices, so the question is answerable.
 * The crew receiving goods are not, which is why that path cascades silently
 * and notifies afterwards instead.
 */
export const previewMaterialPriceImpact = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      materialId: z.string().uuid(),
      newPricePerUnit: z.coerce.number().min(0),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    // Tenant-scope the material before letting its id into the computation.
    const [owned] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(
        and(eq(materials.id, data.materialId), eq(materials.tenantId, tenantId)),
      )
      .limit(1)
    if (!owned) throw new Error('Bahan baku tidak ditemukan')

    const impact = await previewMaterialPriceChange(
      tenantId,
      data.materialId,
      data.newPricePerUnit,
    )

    // Attach names so the dialog can list products without a second call.
    const ids = impact.products.map((p) => p.productId)
    const names =
      ids.length > 0
        ? await db
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(
              and(eq(products.tenantId, tenantId), inArray(products.id, ids)),
            )
        : []
    const nameById = new Map(names.map((n) => [n.id, n.name]))

    return {
      ...impact,
      products: impact.products.map((p) => ({
        ...p,
        name: nameById.get(p.productId) ?? '—',
      })),
    }
  })

export const deleteMaterial = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(materials)
      .where(and(eq(materials.id, data.id), eq(materials.tenantId, tenantId)))
    return { success: true }
  })

// ─── Products ──────────────────────────────────────────

export const getProducts = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()
  return db
    .select()
    .from(products)
    .where(eq(products.tenantId, tenantId))
    .orderBy(products.name)
})

export const getProduct = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const result = await db
      .select()
      .from(products)
      .where(and(eq(products.id, data.id), eq(products.tenantId, tenantId)))
      .limit(1)
    if (result.length === 0) throw new Error('Produk tidak ditemukan')
    return result[0]!
  })

export const createProduct = createServerFn({ method: 'POST' })
  .inputValidator(createProductSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [product] = await db
      .insert(products)
      .values({ ...data, tenantId })
      .returning()
    return product!
  })

export const updateProduct = createServerFn({ method: 'POST' })
  .inputValidator(updateProductSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const { id, ...updates } = data
    const [product] = await db
      .update(products)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .returning()
    if (!product) throw new Error('Produk tidak ditemukan')
    return product
  })

export const deleteProduct = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(products)
      .where(and(eq(products.id, data.id), eq(products.tenantId, tenantId)))
    return { success: true }
  })

/**
 * Clone an HPP product (header + every BOM row) into a new row owned
 * by the same tenant. Generates the cloned name by stripping any
 * existing " Copy N" suffix on the source name, then picking the next
 * unused N across the tenant's catalog so repeated duplicates of the
 * same item land on "Foo Copy 1", "Foo Copy 2", etc.
 *
 * photoKey is intentionally shared with the original — S3 objects are
 * immutable, both rows safely point at the same image.
 *
 * hpp / margin are recomputed by the BOM walker on first edit; we
 * still seed them from the source so the list view doesn't show "-"
 * until the user opens the calculator.
 */
export const duplicateProduct = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    const [original] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, data.id), eq(products.tenantId, tenantId)))
      .limit(1)
    if (!original) throw new Error('Produk tidak ditemukan')

    // Base name is the source name with any existing " Copy N" tail
    // chopped off. That way "Foo Copy 1" duplicated again yields
    // "Foo Copy 2" (not "Foo Copy 1 Copy 1").
    const copySuffixRe = /\s+Copy\s+\d+\s*$/i
    const baseName = original.name.replace(copySuffixRe, '')

    // Find every existing name in this tenant that starts with the
    // base and ends with " Copy <number>" so we can pick the next free
    // suffix. ilike pattern is anchored with "%" on the trailing
    // number — application code parses the suffix to find the max.
    const existing = await db
      .select({ name: products.name })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          ilike(products.name, `${baseName} Copy %`),
        ),
      )

    let nextN = 1
    const suffixRe = new RegExp(
      `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+Copy\\s+(\\d+)\\s*$`,
      'i',
    )
    for (const row of existing) {
      const m = row.name.match(suffixRe)
      if (!m) continue
      const n = Number.parseInt(m[1]!, 10)
      if (Number.isFinite(n) && n >= nextN) nextN = n + 1
    }
    const newName = `${baseName} Copy ${nextN}`

    return db.transaction(async (tx) => {
      const [cloned] = await tx
        .insert(products)
        .values({
          tenantId,
          name: newName,
          sku: original.sku,
          category: original.category,
          sellingPrice: original.sellingPrice,
          hpp: original.hpp,
          margin: original.margin,
          productionQty: original.productionQty,
          productionUnit: original.productionUnit,
          photoKey: original.photoKey,
          notes: original.notes,
        })
        .returning()
      if (!cloned) throw new Error('Gagal menduplikat produk')

      const bomRows = await tx
        .select({
          materialId: productMaterials.materialId,
          sourceProductId: productMaterials.sourceProductId,
          quantity: productMaterials.quantity,
          unitId: productMaterials.unitId,
          addAt: productMaterials.addAt,
        })
        .from(productMaterials)
        .where(
          and(
            eq(productMaterials.productId, original.id),
            eq(productMaterials.tenantId, tenantId),
          ),
        )

      if (bomRows.length > 0) {
        await tx.insert(productMaterials).values(
          bomRows.map((r) => ({
            tenantId,
            productId: cloned.id,
            materialId: r.materialId,
            sourceProductId: r.sourceProductId,
            quantity: r.quantity,
            unitId: r.unitId,
            addAt: r.addAt,
          })),
        )
      }

      return cloned
    })
  })

// ─── Product Materials (BOM / Recipe) ──────────────────

export const getProductMaterials = createServerFn()
  .inputValidator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    // INNER JOIN on materials filters out sub-product BOM rows (where
    // material_id IS NULL post JUR-10). The legacy Recipe Builder only
    // deals with material-sourced rows; sub-product rows live in the
    // step-2 calculator UI and are queried via a separate path. The
    // post-query map normalises the type back to non-nullable
    // materialId for callers (Drizzle still types it nullable since
    // the column is, even though the inner-join guarantees non-null
    // in practice).
    // Two unit FKs to resolve in this query: the recipe row's unit
    // (productMaterials.unitId) and the underlying material's natural
    // unit (materials.unitId). Aliased master_hpp_units joins keep
    // them addressable by name.
    const recipeUnit = alias(masterHppUnits, 'recipe_unit')
    const matUnit = alias(masterHppUnits, 'material_unit')
    const rows = await db
      .select({
        id: productMaterials.id,
        productId: productMaterials.productId,
        materialId: productMaterials.materialId,
        quantity: productMaterials.quantity,
        unit: recipeUnit.value,
        materialName: materials.name,
        materialBrand: materials.brand,
        materialUnit: matUnit.value,
        pricePerUnit: materials.pricePerUnit,
        supplierName: suppliers.name,
      })
      .from(productMaterials)
      .innerJoin(materials, eq(productMaterials.materialId, materials.id))
      .innerJoin(recipeUnit, eq(recipeUnit.id, productMaterials.unitId))
      .innerJoin(matUnit, eq(matUnit.id, materials.unitId))
      .leftJoin(suppliers, eq(materials.supplierId, suppliers.id))
      .where(
        and(
          eq(productMaterials.productId, data.productId),
          eq(productMaterials.tenantId, tenantId),
        ),
      )
    return rows.map((r) => ({ ...r, materialId: r.materialId as string }))
  })

/** Fetch product + its BOM for editing.
 *
 * BOM is a UNION of two kinds of rows (DB CHECK enforces XOR):
 *   - material-sourced: materialId set, sourceProductId null
 *   - sub-product-sourced (nested recipe): sourceProductId set,
 *     materialId null
 *
 * Earlier this fn used `INNER JOIN materials` which silently dropped
 * every sub-product row from the response — surfacing as "my Biang Teh
 * disappeared from the Lemon Tea recipe" even though the rows were
 * intact in the DB. We now LEFT JOIN materials + LEFT JOIN the source
 * product, then collapse the two row kinds into a single typed list
 * where `materialId XOR sourceProductId` is non-null. The edit form
 * (calculator) + the detail dialog cost breakdown both consume this. */
export const getProductForEdit = createServerFn()
  .inputValidator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, data.productId), eq(products.tenantId, tenantId)))
      .limit(1)

    if (!product) throw new Error('Produk tidak ditemukan')

    const recipeUnit = alias(masterHppUnits, 'recipe_unit')
    const sourceProduct = alias(products, 'source_product')
    const bom = await db
      .select({
        id: productMaterials.id,
        materialId: productMaterials.materialId,
        sourceProductId: productMaterials.sourceProductId,
        quantity: productMaterials.quantity,
        unit: recipeUnit.value,
        addAt: productMaterials.addAt,
        // Material side (null when this BOM row is a sub-product)
        materialName: materials.name,
        materialBrand: materials.brand,
        pricePerUnit: materials.pricePerUnit,
        supplierName: suppliers.name,
        // Sub-product side (null when this BOM row is material-sourced).
        // The calculator derives the per-unit price client-side as
        // `sourceHpp / sourceProductionQty` to match the value used
        // when the row was first added — same math as productOptions.
        sourceName: sourceProduct.name,
        sourceHpp: sourceProduct.hpp,
        sourceProductionQty: sourceProduct.productionQty,
        sourceProductionUnit: sourceProduct.productionUnit,
      })
      .from(productMaterials)
      .leftJoin(materials, eq(productMaterials.materialId, materials.id))
      .leftJoin(
        sourceProduct,
        eq(productMaterials.sourceProductId, sourceProduct.id),
      )
      .innerJoin(recipeUnit, eq(recipeUnit.id, productMaterials.unitId))
      .leftJoin(suppliers, eq(materials.supplierId, suppliers.id))
      .where(
        and(
          eq(productMaterials.productId, data.productId),
          eq(productMaterials.tenantId, tenantId),
        ),
      )

    return {
      product: {
        ...product,
        sellingPrice: Number(product.sellingPrice),
        hpp: product.hpp ? Number(product.hpp) : null,
        margin: product.margin ? Number(product.margin) : null,
      },
      materials: bom,
    }
  })

export const addProductMaterial = createServerFn({ method: 'POST' })
  .inputValidator(createProductMaterialSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [pm] = await db
      .insert(productMaterials)
      .values({ ...data, tenantId })
      .returning()
    return pm!
  })

/**
 * JUR-10: persist a product-as-ingredient (nested recipe / sub-recipe)
 * row. The HPP step-2 calculator UI lets owners pick a sub-product as
 * a cost component; this fn writes the structural link so JUR-10's
 * deduction notification can flag nested recipes (and a future v2 can
 * recurse through them). Stored as `productMaterials` with
 * `materialId IS NULL` and `sourceProductId IS NOT NULL` — the
 * mutual-exclusion CHECK guarantees exactly one is set.
 */
export const addProductSubProduct = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      productId: z.string().uuid('Produk wajib dipilih'),
      sourceProductId: z.string().uuid('Sub-produk wajib dipilih'),
      quantity: z
        .string()
        .regex(/^\d+(\.\d{1,4})?$/, 'Jumlah tidak valid'),
      unitId: z.string().uuid('Satuan wajib dipilih'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    if (data.productId === data.sourceProductId) {
      throw new Error('Produk tidak bisa jadi bahan untuk dirinya sendiri.')
    }
    const [pm] = await db
      .insert(productMaterials)
      .values({
        tenantId,
        productId: data.productId,
        sourceProductId: data.sourceProductId,
        quantity: data.quantity,
        unitId: data.unitId,
      })
      .returning()
    return pm!
  })

export const updateProductMaterial = createServerFn({ method: 'POST' })
  .inputValidator(updateProductMaterialSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const { id, ...updates } = data
    const [pm] = await db
      .update(productMaterials)
      .set(updates)
      .where(
        and(eq(productMaterials.id, id), eq(productMaterials.tenantId, tenantId)),
      )
      .returning()
    if (!pm) throw new Error('Resep tidak ditemukan')
    return pm
  })

export const removeProductMaterial = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(productMaterials)
      .where(
        and(eq(productMaterials.id, data.id), eq(productMaterials.tenantId, tenantId)),
      )
    return { success: true }
  })

/** Remove all BOM entries for a product (used before re-adding during edit) */
export const clearProductMaterials = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(productMaterials)
      .where(
        and(
          eq(productMaterials.productId, data.productId),
          eq(productMaterials.tenantId, tenantId),
        ),
      )
    return { success: true }
  })

/**
 * JUR-85: atomic BOM rewrite — DELETE existing rows for the product and
 * INSERT the new list in a single transaction. If any insert fails the
 * whole rewrite rolls back, so the recipe is never left in a half-empty
 * state. Replaces the wizard's old "call clearProductMaterials, then
 * loop addProductMaterial" sequence, which used to wipe the recipe when
 * a mid-loop client-side error (e.g. a unit-resolve race) skipped the
 * inserts.
 *
 * Each item must declare exactly one of materialId / sourceProductId
 * (matching the existing `product_materials_source_chk` constraint).
 * The handler validates this client-side too so we can throw a friendly
 * Indonesian error instead of a CHECK violation.
 */
const replaceProductMaterialsSchema = z.object({
  productId: z.string().uuid(),
  items: z
    .array(
      z.object({
        materialId: z.string().uuid().nullable().optional(),
        sourceProductId: z.string().uuid().nullable().optional(),
        quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Jumlah tidak valid'),
        unitId: z.string().uuid('Satuan wajib dipilih'),
        addAt: z.enum(['prep', 'finish']).optional(),
      }),
    )
    .max(200, 'Terlalu banyak baris bahan (maks 200)'),
})

export const replaceProductMaterials = createServerFn({ method: 'POST' })
  .inputValidator(replaceProductMaterialsSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    // Pre-flight: every row must have exactly one source. Fail BEFORE
    // entering the tx so we never even touch the DB on bad input.
    for (const [idx, item] of data.items.entries()) {
      const hasMaterial = !!item.materialId
      const hasProduct = !!item.sourceProductId
      if (hasMaterial === hasProduct) {
        throw new Error(
          `Baris bahan #${idx + 1}: harus pilih salah satu antara bahan baku atau produk sub-resep.`,
        )
      }
    }

    return db.transaction(async (tx) => {
      await tx
        .delete(productMaterials)
        .where(
          and(
            eq(productMaterials.productId, data.productId),
            eq(productMaterials.tenantId, tenantId),
          ),
        )

      if (data.items.length === 0) {
        return { rows: [] }
      }

      const rows = await tx
        .insert(productMaterials)
        .values(
          data.items.map((item) => ({
            tenantId,
            productId: data.productId,
            materialId: item.materialId ?? null,
            sourceProductId: item.sourceProductId ?? null,
            quantity: item.quantity,
            unitId: item.unitId,
            addAt: item.addAt ?? 'prep',
          })),
        )
        .returning()

      return { rows }
    })
  })

// ─── Overhead Costs ────────────────────────────────────

export const getOverheadCosts = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()
  return db
    .select()
    .from(overheadCosts)
    .where(eq(overheadCosts.tenantId, tenantId))
    .orderBy(overheadCosts.name)
})

export const createOverhead = createServerFn({ method: 'POST' })
  .inputValidator(createOverheadSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [overhead] = await db
      .insert(overheadCosts)
      .values({ ...data, tenantId })
      .returning()
    return overhead!
  })

export const updateOverhead = createServerFn({ method: 'POST' })
  .inputValidator(updateOverheadSchema)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const { id, ...updates } = data
    const [overhead] = await db
      .update(overheadCosts)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(overheadCosts.id, id), eq(overheadCosts.tenantId, tenantId)))
      .returning()
    if (!overhead) throw new Error('Biaya overhead tidak ditemukan')
    return overhead
  })

export const deleteOverhead = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    await db
      .delete(overheadCosts)
      .where(
        and(eq(overheadCosts.id, data.id), eq(overheadCosts.tenantId, tenantId)),
      )
    return { success: true }
  })

// ─── HPP Calculation ───────────────────────────────────

/** Set HPP directly — used when cost items include other products (not just raw materials) */
export const setProductHpp = createServerFn({ method: 'POST' })
  .inputValidator(z.object({
    productId: z.string().uuid(),
    hpp: z.number().min(0),
  }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, data.productId), eq(products.tenantId, tenantId)))

    if (!product) throw new Error('Produk tidak ditemukan')

    // `data.hpp` is the batch cost; margin is per-unit economics, so
    // divide by productionQty before comparing to the per-unit price.
    const sellingPrice = Number(product.sellingPrice)
    const unitHpp = perUnitHpp(data.hpp, Number(product.productionQty))
    const margin = sellingPrice > 0 ? ((sellingPrice - unitHpp) / sellingPrice) * 100 : 0

    await db
      .update(products)
      .set({
        hpp: data.hpp.toFixed(2),
        margin: margin.toFixed(2),
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, data.productId), eq(products.tenantId, tenantId)))

    return { productId: data.productId, hpp: data.hpp, margin }
  })

export const calculateProductHpp = createServerFn()
  .inputValidator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    // Get product
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, data.productId), eq(products.tenantId, tenantId)))

    if (!product) throw new Error('Produk tidak ditemukan')

    // Get the BOM with prices.
    //
    // A BOM row is EITHER material-sourced or sub-product-sourced (the DB
    // CHECK enforces `materialId XOR sourceProductId`). This used to
    // `INNER JOIN materials`, which silently dropped every sub-product row
    // — so a product built from another product was costed as if its
    // sub-recipes were free, understating HPP and overstating margin.
    // `getProductForEdit` had the identical bug and was fixed; this one was
    // missed, which is why the calculator UI and the stored `products.hpp`
    // could disagree on the same recipe.
    //
    // Sub-product pricing follows the convention already used by
    // `getProductForEdit` and the calculator: the per-unit price of a
    // sub-product is `sourceHpp / sourceProductionQty`, i.e. its batch cost
    // divided by what one batch yields.
    const recipeUnit = alias(masterHppUnits, 'recipe_unit')
    const sourceProduct = alias(products, 'source_product')
    const bom = await db
      .select({
        quantity: productMaterials.quantity,
        unit: recipeUnit.value,
        materialId: productMaterials.materialId,
        pricePerUnit: materials.pricePerUnit,
        materialName: materials.name,
        sourceProductId: productMaterials.sourceProductId,
        sourceName: sourceProduct.name,
        sourceHpp: sourceProduct.hpp,
        sourceProductionQty: sourceProduct.productionQty,
      })
      .from(productMaterials)
      .leftJoin(materials, eq(productMaterials.materialId, materials.id))
      .leftJoin(
        sourceProduct,
        eq(productMaterials.sourceProductId, sourceProduct.id),
      )
      .innerJoin(recipeUnit, eq(recipeUnit.id, productMaterials.unitId))
      .where(
        and(
          eq(productMaterials.productId, data.productId),
          eq(productMaterials.tenantId, tenantId),
        ),
      )

    /** Per-unit price for a BOM row — see `bomRowUnitPrice` for the rules. */
    const rowUnitPrice = (row: (typeof bom)[number]): number =>
      bomRowUnitPrice(
        row.materialId
          ? { kind: 'material', pricePerUnit: row.pricePerUnit }
          : {
              kind: 'sub-product',
              sourceHpp: row.sourceHpp,
              sourceProductionQty: row.sourceProductionQty,
            },
      )

    // Authoritative cost comes from the engine, not from summing this
    // product's rows here.
    //
    // Summing locally has to price a sub-recipe row from the sub-product's
    // STORED hpp, which may itself be stale — a parent then inherits a number
    // nobody recomputed. The engine rebuilds the whole tenant graph from live
    // material prices in topological order, so a parent is only costed once
    // every sub-recipe under it is final. It also refuses to guess inside a
    // recipe cycle, which local summing cannot detect at all.
    const graph = await computeTenantHpp(tenantId)
    const computed = graph.values.get(data.productId)

    if (!computed) {
      // Only reachable when this product sits in (or depends on) a cycle.
      // Leave the stored value alone: stale is recoverable, wrong prices a
      // menu.
      throw new Error(
        'Resep ini saling mereferensi satu sama lain (sub-resep melingkar), jadi HPP-nya tidak bisa dihitung. Periksa komposisi sub-produknya.',
      )
    }

    const hpp = computed.hpp
    const margin = computed.margin
    const sellingPrice = Number(product.sellingPrice)

    // Per-row breakdown for the UI. Sub-product rows are priced from the
    // engine's freshly computed value where available, falling back to the
    // stored one, so the breakdown adds up to the same total the engine
    // reported rather than drifting from it.
    const rowsWithCost = bom.map((item) => {
      const subComputed = item.sourceProductId
        ? graph.values.get(item.sourceProductId)
        : undefined
      const unitPrice = subComputed
        ? bomRowUnitPrice({
            kind: 'sub-product',
            sourceHpp: subComputed.hpp,
            sourceProductionQty: item.sourceProductionQty,
          })
        : rowUnitPrice(item)
      return {
        item,
        unitPrice,
        totalCost: calculateMaterialCost(unitPrice, Number(item.quantity)),
      }
    })
    const totalMaterialCost = hpp

    // Update product with calculated HPP and margin
    await db
      .update(products)
      .set({
        hpp: hpp.toFixed(2),
        margin: margin.toFixed(2),
        updatedAt: new Date(),
      })
      .where(and(eq(products.id, data.productId), eq(products.tenantId, tenantId)))

    return {
      productId: product.id,
      productName: product.name,
      totalMaterialCost,
      hpp,
      sellingPrice,
      margin,
      // Sub-product rows report the sub-product's name and its engine-derived
      // per-unit cost, so the breakdown adds up to the same total the engine
      // reported instead of showing a gap where the nested recipe was.
      materialDetails: rowsWithCost.map(({ item, unitPrice, totalCost }) => ({
        materialName: item.materialId ? item.materialName : item.sourceName,
        quantity: Number(item.quantity),
        unit: item.unit,
        pricePerUnit: unitPrice,
        totalCost,
      })),
    }
  })

export const recalculateAllHpp = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { tenantId } = await requireAuth()

    // Build the graph ONCE for the whole tenant.
    //
    // This used to loop over products calling `calculateProductHpp`, which was
    // acceptable when that function ran a single BOM query — but it now builds
    // the full tenant graph, so the loop would rebuild it once per product:
    // three queries and a full traversal each. At 124 products that is ~372
    // round trips against the connection pooler, comfortably into
    // server-function timeout territory, and it grows with the catalog.
    //
    // Computing once and writing the results is also simply what the engine is
    // for: every product is costed in one topologically-ordered pass.
    const graph = await computeTenantHpp(tenantId)

    const results: Array<{ productId: string; hpp: number; margin: number }> = []
    for (const [productId, computed] of graph.values) {
      await db
        .update(products)
        .set({
          hpp: computed.hpp.toFixed(2),
          margin: computed.margin.toFixed(2),
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
      results.push({
        productId,
        hpp: computed.hpp,
        margin: computed.margin,
      })
    }

    // Products inside a recipe cycle are left exactly as they were — a stale
    // number is recoverable, a wrong one silently prices a menu. They are
    // reported so the caller can surface which recipes need untangling.
    return {
      updated: results,
      unresolved: graph.unresolved,
      maxDepth: graph.maxDepth,
    }
  },
)

export const getHppReport = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()

  const [allProducts, allMaterials] = await Promise.all([
    db
      .select()
      .from(products)
      .where(eq(products.tenantId, tenantId))
      .orderBy(products.name),
    db
      .select({ id: materials.id })
      .from(materials)
      .where(eq(materials.tenantId, tenantId)),
  ])

  // Read-time fallback: for every HPP product without its own
  // photo_key, look up the photo_key of any linked POS/inventory item
  // (linked_hpp_product_id FK). Never copied at write time — if the
  // link is removed, the HPP product silently falls back to the
  // placeholder again.
  const productsMissingPhoto = allProducts.filter((p) => !p.photoKey)
  const fallbackByProductId: Record<string, string | null> = {}
  if (productsMissingPhoto.length > 0) {
    const linked = await db
      .select({
        linkedHppProductId: inventoryItems.linkedHppProductId,
        photoKey: inventoryItems.photoKey,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, tenantId),
          isNotNull(inventoryItems.photoKey),
          inArray(
            inventoryItems.linkedHppProductId,
            productsMissingPhoto.map((p) => p.id),
          ),
        ),
      )
    // First link wins — same product can be linked from multiple
    // inventory items if a tenant misconfigured them; we don't care
    // which photo shows up, just that one does.
    for (const row of linked) {
      if (
        row.linkedHppProductId &&
        row.photoKey &&
        !fallbackByProductId[row.linkedHppProductId]
      ) {
        fallbackByProductId[row.linkedHppProductId] = row.photoKey
      }
    }
  }

  return {
    products: allProducts.map((p) => ({
      ...p,
      hpp: p.hpp ? Number(p.hpp) : null,
      margin: p.margin ? Number(p.margin) : null,
      sellingPrice: Number(p.sellingPrice),
      // Convenience field: photoKey OR fallback, whichever exists.
      // Consumers that need to know if it was a fallback (e.g. to dim
      // it slightly) can still inspect `photoKey` vs this field.
      effectivePhotoKey: p.photoKey ?? fallbackByProductId[p.id] ?? null,
    })),
    materialCount: allMaterials.length,
  }
})

// ─── HPP product photo (Item 3 UI/UX review) ──────────────────────

export const uploadHppProductPhotoFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      productId: z.string().uuid(),
      photoDataUrl: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(eq(products.id, data.productId), eq(products.tenantId, tenantId)),
      )
      .limit(1)
    if (!product) throw new Error('Produk tidak ditemukan')

    const { bytes, mimeType } = parseDataUrl(data.photoDataUrl)
    const { key } = await uploadHppProductPhoto({
      tenantId,
      productId: data.productId,
      bytes,
      mimeType,
    })

    await db
      .update(products)
      .set({ photoKey: key, updatedAt: new Date() })
      .where(eq(products.id, data.productId))

    return { photoKey: key }
  })

export const removeHppProductPhoto = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    const [product] = await db
      .select({ photoKey: products.photoKey })
      .from(products)
      .where(
        and(eq(products.id, data.productId), eq(products.tenantId, tenantId)),
      )
      .limit(1)
    if (!product) throw new Error('Produk tidak ditemukan')

    if (product.photoKey) {
      try {
        await deleteHppProductPhoto(product.photoKey)
      } catch {
        // Best-effort — DB column is the source of truth.
      }
    }

    await db
      .update(products)
      .set({ photoKey: null, updatedAt: new Date() })
      .where(eq(products.id, data.productId))

    return { ok: true }
  })

/**
 * Batch signed-URL fetcher for the /hpp table. Accepts both the HPP
 * product's own photoKey AND fallback inventory photoKeys in one call
 * so the table can render every thumbnail with a single round-trip.
 */
export const getHppPhotoUrls = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ keys: z.array(z.string()).max(500) }))
  .handler(async ({ data }) => {
    await requireAuth()
    const entries = await Promise.all(
      data.keys.map(async (key) => {
        try {
          const url = await getHppProductPhotoSignedUrl(key, 300)
          return [key, url] as const
        } catch {
          return [key, null] as const
        }
      }),
    )
    return Object.fromEntries(entries) as Record<string, string | null>
  })
