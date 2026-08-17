/**
 * One-way sync of an HPP product's selling price onto the POS item it is
 * linked to.
 *
 * An HPP product and the inventory item created from it describe the same
 * thing being sold, but until now they carried two independent prices. The HPP
 * screen would report a margin against Rp 4.000 while the cashier charged
 * whatever the POS price list happened to say — a margin describing a price
 * nobody was ever charged.
 *
 * The sync is ONE-WAY (HPP → POS) and deliberately narrow:
 *
 *   - Only the FIRST tier (`minQty = 1`) on the item's BASE unit. An HPP
 *     product carries a single price and simply cannot express a tier ladder
 *     ("≥1 Rp 4.000, ≥10 Rp 3.500"). Bulk tiers and alternate units stay
 *     manual, because inventing values for them would be guessing at a
 *     merchant's wholesale policy.
 *   - Only the product being edited, never the whole tenant. A tenant-wide
 *     pass would silently "resolve" divergences on unrelated products the
 *     moment somebody saved any product — including ones priced differently
 *     on purpose.
 *   - Cost is NOT recorded here. `hpp_price_history` is a ledger of cost
 *     movements; a selling-price change is a different kind of event and
 *     logging it there would blur what that table means.
 */
import { db } from '@vintra/db'
import {
  inventoryItems,
  inventoryItemUnits,
  inventoryItemUnitPricing,
} from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'
import type { DbExecutor } from './hpp-cascade'

export interface PosPriceSyncResult {
  /** Items whose tier-1 base-unit price was rewritten. */
  updated: Array<{ itemId: string; oldPrice: number | null; newPrice: number }>
}

/**
 * Push `sellingPrice` onto every inventory item linked to this HPP product.
 *
 * In practice that is zero or one item, but the schema does not enforce
 * one-to-one, so this handles several rather than assuming.
 */
export async function syncPosPriceFromHppProduct(
  tenantId: string,
  productId: string,
  sellingPrice: number,
  exec: DbExecutor = db,
): Promise<PosPriceSyncResult> {
  const items = await exec
    .select({ id: inventoryItems.id, baseUnitId: inventoryItems.baseUnitId })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.linkedHppProductId, productId),
      ),
    )

  const updated: PosPriceSyncResult['updated'] = []

  for (const item of items) {
    if (!item.baseUnitId) continue

    // The base unit must actually be configured as sellable before it can be
    // priced — pricing a unit the cashier cannot pick would be dead data.
    const [unitRow] = await exec
      .select({ id: inventoryItemUnits.id })
      .from(inventoryItemUnits)
      .where(
        and(
          eq(inventoryItemUnits.itemId, item.id),
          eq(inventoryItemUnits.unitId, item.baseUnitId),
        ),
      )
      .limit(1)
    if (!unitRow) continue

    const [existing] = await exec
      .select({ unitPrice: inventoryItemUnitPricing.unitPrice })
      .from(inventoryItemUnitPricing)
      .where(
        and(
          eq(inventoryItemUnitPricing.itemId, item.id),
          eq(inventoryItemUnitPricing.unitId, item.baseUnitId),
          eq(inventoryItemUnitPricing.minQty, '1'),
        ),
      )
      .limit(1)

    const oldPrice = existing ? Number(existing.unitPrice) : null
    if (oldPrice != null && Math.round(oldPrice * 100) === Math.round(sellingPrice * 100)) {
      continue
    }

    await exec
      .insert(inventoryItemUnitPricing)
      .values({
        tenantId,
        itemId: item.id,
        unitId: item.baseUnitId,
        minQty: '1',
        unitPrice: sellingPrice.toFixed(2),
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: [
          inventoryItemUnitPricing.itemId,
          inventoryItemUnitPricing.unitId,
          inventoryItemUnitPricing.minQty,
        ],
        set: { unitPrice: sellingPrice.toFixed(2), updatedAt: new Date() },
      })

    // Nothing else to write: `inventoryItems.sellingPrice` is deprecated and
    // every price now lives in the per-(unit, qty) tier table. The tier IS the
    // price.

    updated.push({ itemId: item.id, oldPrice, newPrice: sellingPrice })
  }

  return { updated }
}

/**
 * Error thrown when someone tries to price a recipe-linked item directly.
 *
 * Refused on the SERVER rather than merely hidden in the web form, because
 * the mobile app calls `upsertPricingTier` too — a disabled input protects one
 * client, not the rule.
 */
export const POS_PRICE_READONLY_ERROR =
  'Harga item ini mengikuti produk HPP-nya. Ubah harga jualnya di HPP → Edit Produk → langkah 3 (Harga Jual).'
