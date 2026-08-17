/**
 * Database loader for the HPP engine.
 *
 * Kept separate from `hpp-engine.ts` so the computation stays a pure module
 * with no database import — its tests then need no driver, and nothing about
 * the formula can quietly come to depend on a query.
 */
import { db } from '@vintra/db'
import { products, productMaterials, materials } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'
import { computeHpp, type HppComputeResult } from './hpp-engine'

/**
 * Load one tenant's recipe graph and compute every product's HPP.
 *
 * Three queries regardless of catalog size — the point of batching is that a
 * cascade triggered by one material price change never degrades into
 * per-product round trips.
 */
export async function computeTenantHpp(
  tenantId: string,
): Promise<HppComputeResult> {
  const [productRows, bomRows, materialRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sellingPrice: products.sellingPrice,
        productionQty: products.productionQty,
      })
      .from(products)
      .where(eq(products.tenantId, tenantId)),
    db
      .select({
        productId: productMaterials.productId,
        materialId: productMaterials.materialId,
        sourceProductId: productMaterials.sourceProductId,
        quantity: productMaterials.quantity,
      })
      .from(productMaterials)
      .where(eq(productMaterials.tenantId, tenantId)),
    db
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
    new Map(materialRows.map((m) => [m.id, Number(m.pricePerUnit ?? 0)])),
  )
}
