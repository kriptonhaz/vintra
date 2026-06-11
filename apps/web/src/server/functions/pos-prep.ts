/**
 * Prep-batch server functions (JUR-15).
 *
 * Three operations:
 *   - recordPrepBatch: owner runs "Prep batch" → ingredients deducted
 *     via the existing BOM walk + a new row inserted into
 *     inventory_item_prep_batches. POS sales of this item then
 *     FIFO-consume that counter instead of re-deducting BOM.
 *   - getPrepStatus: current `Siap` for a (item, branch) — the
 *     remaining `SUM(qty_prepared - qty_consumed)` across open rows.
 *   - listPrepBatches: history feed for inventory page + waste report.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  inventoryItems,
  inventoryItemUnits,
  inventoryItemPrepBatches,
  branches,
  masterHppUnits,
} from '@vintra/db/schema'
import { and, eq, sql, gte, lte, desc } from 'drizzle-orm'
import { posTierLimits } from '@vintra/shared'
import { requirePOSAccess } from '../middleware/module-access'
import { deductBomIngredients } from '../lib/bom-deduct'

const recordPrepBatchSchema = z.object({
  itemId: z.string().uuid(),
  branchId: z.string().uuid(),
  /**
   * Qty entered in the item's DEFAULT unit (whatever the cashier sees on
   * the tile — usually "cup" / "pcs" / "porsi"). Converted to base before
   * persisting so the FIFO consume math against sale qty (also in base)
   * works without surprises.
   */
  qty: z.number().positive(),
  unitId: z.string().uuid(),
  notes: z.string().max(500).optional(),
})

export const recordPrepBatch = createServerFn({ method: 'POST' })
  .inputValidator(recordPrepBatchSchema)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    // Permission gate — separate from POS access. Prep is an inventory
    // mutation (it writes stock movements), so `inventory.write` is the
    // right permission. Cashiers without inventory.write can sell from
    // existing batches but can't refill.
    if (!auth.permissions.includes('inventory.write')) {
      throw new Error('Forbidden')
    }

    // Tier gate — prep mode only makes sense when ingredient deduction
    // is even possible, which is Toko+ (`ingredient_consumption`).
    // A free-tier tenant has no BOM walk to skip in the first place.
    if (!posTierLimits(auth.posTier).features.includes('ingredient_consumption')) {
      throw new Error('Fitur prep batch tersedia mulai paket Toko.')
    }

    // 1. Load the item + verify ownership + prep mode.
    const [item] = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        baseUnitId: inventoryItems.baseUnitId,
        prepMode: inventoryItems.prepMode,
        linkedHppProductId: inventoryItems.linkedHppProductId,
        isActive: inventoryItems.isActive,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.itemId),
          eq(inventoryItems.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Item tidak ditemukan.')
    if (!item.isActive) throw new Error('Item sudah dinonaktifkan.')
    if (!item.linkedHppProductId) {
      throw new Error('Item ini bukan resep — tidak bisa prep batch.')
    }
    if (!item.prepMode) {
      throw new Error('Mode prep batch belum aktif untuk item ini.')
    }

    // 2. Verify branch belongs to tenant. Cheap defensive check —
    //    spoofed branchId would otherwise insert orphan-looking rows.
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, data.branchId), eq(branches.tenantId, auth.tenantId)))
      .limit(1)
    if (!branch) throw new Error('Cabang tidak ditemukan.')

    // 3. Convert prep qty to BASE units. Same pattern as the cashier
    //    line-prep code: ratio_to_base × user-entered qty.
    let qtyInBase = data.qty
    if (data.unitId !== item.baseUnitId) {
      const [unitRow] = await db
        .select({ ratioToBase: inventoryItemUnits.ratioToBase })
        .from(inventoryItemUnits)
        .where(
          and(
            eq(inventoryItemUnits.itemId, item.id),
            eq(inventoryItemUnits.unitId, data.unitId),
          ),
        )
        .limit(1)
      if (!unitRow) {
        throw new Error('Satuan tidak dikenali untuk item ini.')
      }
      qtyInBase = data.qty * Number(unitRow.ratioToBase)
    }
    if (!Number.isFinite(qtyInBase) || qtyInBase <= 0) {
      throw new Error('Qty prep tidak valid.')
    }

    // 4. Transaction: BOM deduct + batch row insert. If the BOM walk
    //    throws (unmatched recipe unit), the whole prep rolls back —
    //    same semantics as a failed sale.
    const now = new Date()
    const unlinkedMaterials = new Map<string, string>()
    const unscalableSubRecipes = new Map<string, string>()

    const result = await db.transaction(async (tx) => {
      // Insert the batch row FIRST so we have an id to use as
      // referenceId on the stock movements. The BOM walk inserts rows
      // pointing back at this batch.
      const [batch] = await tx
        .insert(inventoryItemPrepBatches)
        .values({
          tenantId: auth.tenantId,
          itemId: item.id,
          branchId: data.branchId,
          qtyPrepared: qtyInBase.toString(),
          qtyConsumed: '0',
          preparedBy: auth.userId,
          preparedAt: now,
          notes: data.notes,
        })
        .returning()
      if (!batch) throw new Error('Gagal membuat batch.')

      await deductBomIngredients({
        tx: tx as unknown as typeof db,
        tenantId: auth.tenantId,
        userId: auth.userId,
        branchId: data.branchId,
        parentLinkedHppProductId: item.linkedHppProductId!,
        parentBaseQty: qtyInBase,
        reason: 'prep_batch',
        referenceType: 'prep_batch',
        referenceId: batch.id,
        notesPrefix: `Prep ${item.name} (${data.qty})`,
        // JUR-15 v2: prep batch only consumes bulk-prep materials.
        // Add-at-counter rows (sugar/syrup/milk) skip and get
        // deducted per sale instead.
        phase: 'prep',
        unlinkedMaterials,
        unscalableSubRecipes,
        now,
      })

      return batch
    })

    // Warnings surfaced to the UI (toast). Same shape as the sale path
    // hands these back. Notifications themselves are emitted by a
    // future ticket — for now, the UI just shows the warnings inline.
    return {
      batch: result,
      warnings: {
        unlinkedMaterials: Array.from(unlinkedMaterials.values()),
        unscalableSubRecipeCount: unscalableSubRecipes.size,
      },
    }
  })

const getPrepStatusSchema = z.object({
  itemId: z.string().uuid(),
  branchId: z.string().uuid(),
})

/**
 * Returns the current `Siap` count in the item's BASE unit. UI converts
 * to the default-display unit. Cashier and inventory list both call this
 * (the cashier hits it for many items at once via listPOSProducts which
 * inlines the same aggregate — this single-item version is for the
 * inventory detail page).
 */
export const getPrepStatus = createServerFn({ method: 'POST' })
  .inputValidator(getPrepStatusSchema)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    const [row] = await db
      .select({
        siapInBase: sql<string>`COALESCE(SUM(${inventoryItemPrepBatches.qtyPrepared} - ${inventoryItemPrepBatches.qtyConsumed}), 0)::text`,
      })
      .from(inventoryItemPrepBatches)
      .where(
        and(
          eq(inventoryItemPrepBatches.tenantId, auth.tenantId),
          eq(inventoryItemPrepBatches.itemId, data.itemId),
          eq(inventoryItemPrepBatches.branchId, data.branchId),
          sql`${inventoryItemPrepBatches.qtyConsumed} < ${inventoryItemPrepBatches.qtyPrepared}`,
        ),
      )

    return { siapInBase: Number(row?.siapInBase ?? 0) }
  })

/**
 * FIFO-consume prep batch counters for a single (item, branch) pair.
 *
 * Called from the POS sale transaction when a recipe-backed line has
 * `prep_mode=true`. Iterates open ledger rows oldest-first under
 * `FOR UPDATE` (so concurrent sales can't double-consume), incrementing
 * each row's `qty_consumed` until the line qty is satisfied. Throws if
 * the open batches don't cover the line — caller rolls back the whole
 * sale, matching the "hard-block at Siap=0" policy chosen in JUR-15.
 *
 * Args:
 *   - `tx`: must be a transaction (we need locking to be meaningful).
 *   - `qtyInBase`: how many units (base) this line needs to consume.
 *
 * NOT a server fn — direct helper. The sale path already has auth/tenant
 * scoping; we trust the caller.
 */
export async function consumePrepBatchesForLine(args: {
  tx: typeof db
  tenantId: string
  itemId: string
  itemName: string
  branchId: string
  qtyInBase: number
  now: Date
}): Promise<void> {
  let remaining = args.qtyInBase
  // Guard against tight loops on bad input. A single line can never
  // need more than `qtyInBase` iterations, and in practice 1-3.
  const MAX_BATCHES_PER_LINE = 50
  for (let i = 0; i < MAX_BATCHES_PER_LINE && remaining > 0; i++) {
    const [batch] = await args.tx
      .select({
        id: inventoryItemPrepBatches.id,
        qtyPrepared: inventoryItemPrepBatches.qtyPrepared,
        qtyConsumed: inventoryItemPrepBatches.qtyConsumed,
      })
      .from(inventoryItemPrepBatches)
      .where(
        and(
          eq(inventoryItemPrepBatches.tenantId, args.tenantId),
          eq(inventoryItemPrepBatches.itemId, args.itemId),
          eq(inventoryItemPrepBatches.branchId, args.branchId),
          sql`${inventoryItemPrepBatches.qtyConsumed} < ${inventoryItemPrepBatches.qtyPrepared}`,
        ),
      )
      .orderBy(inventoryItemPrepBatches.preparedAt)
      .limit(1)
      .for('update')

    if (!batch) {
      throw new Error(
        `Stok prep "${args.itemName}" habis. Lakukan "Prep batch" dulu sebelum menjual lagi.`,
      )
    }

    const available = Number(batch.qtyPrepared) - Number(batch.qtyConsumed)
    const take = Math.min(remaining, available)
    const newConsumed = Number(batch.qtyConsumed) + take

    await args.tx
      .update(inventoryItemPrepBatches)
      .set({
        qtyConsumed: newConsumed.toString(),
        updatedAt: args.now,
      })
      .where(eq(inventoryItemPrepBatches.id, batch.id))

    remaining -= take
  }
  if (remaining > 0) {
    // Hit the loop cap — defensive guard against runaway iteration.
    // In practice never reached unless the prep ledger has thousands
    // of fragments for one item.
    throw new Error(
      `Konsumsi prep "${args.itemName}" melebihi batas iterasi. Hubungi admin.`,
    )
  }
}

const listPrepBatchesSchema = z.object({
  itemId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  /** ISO date string; inclusive. */
  dateFrom: z.string().optional(),
  /** ISO date string; exclusive. */
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

/**
 * Batch history feed. Powers the per-item detail panel ("recent preps")
 * AND the waste report (date range + group by item externally).
 */
export const listPrepBatches = createServerFn({ method: 'POST' })
  .inputValidator(listPrepBatchesSchema)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()

    const conditions = [eq(inventoryItemPrepBatches.tenantId, auth.tenantId)]
    if (data.itemId) conditions.push(eq(inventoryItemPrepBatches.itemId, data.itemId))
    if (data.branchId) conditions.push(eq(inventoryItemPrepBatches.branchId, data.branchId))
    if (data.dateFrom) {
      conditions.push(gte(inventoryItemPrepBatches.preparedAt, new Date(data.dateFrom)))
    }
    if (data.dateTo) {
      conditions.push(lte(inventoryItemPrepBatches.preparedAt, new Date(data.dateTo)))
    }

    const rows = await db
      .select({
        id: inventoryItemPrepBatches.id,
        itemId: inventoryItemPrepBatches.itemId,
        itemName: inventoryItems.name,
        baseUnitLabel: masterHppUnits.label,
        branchId: inventoryItemPrepBatches.branchId,
        branchName: branches.name,
        qtyPrepared: inventoryItemPrepBatches.qtyPrepared,
        qtyConsumed: inventoryItemPrepBatches.qtyConsumed,
        notes: inventoryItemPrepBatches.notes,
        preparedAt: inventoryItemPrepBatches.preparedAt,
      })
      .from(inventoryItemPrepBatches)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryItemPrepBatches.itemId))
      .innerJoin(branches, eq(branches.id, inventoryItemPrepBatches.branchId))
      .innerJoin(masterHppUnits, eq(masterHppUnits.id, inventoryItems.baseUnitId))
      .where(and(...conditions))
      .orderBy(desc(inventoryItemPrepBatches.preparedAt))
      .limit(data.limit ?? 50)

    return rows.map((r) => ({
      ...r,
      qtyPrepared: Number(r.qtyPrepared),
      qtyConsumed: Number(r.qtyConsumed),
      qtyLeftover: Number(r.qtyPrepared) - Number(r.qtyConsumed),
    }))
  })

const prepWasteReportSchema = z.object({
  /** ISO YYYY-MM-DD (Jakarta-zone day). Inclusive. */
  dateFrom: z.string(),
  /** ISO YYYY-MM-DD (Jakarta-zone day). Inclusive. */
  dateTo: z.string(),
  branchId: z.string().uuid().optional(),
})

export interface PrepWasteRow {
  day: string
  itemId: string
  itemName: string
  branchId: string
  branchName: string
  baseUnitLabel: string
  qtyPrepared: number
  qtyConsumed: number
  qtyLeftover: number
}

/**
 * Waste report — SUM(prepared / consumed / leftover) grouped by
 * (day, item, branch) for the chosen date range. Owner-facing — shows
 * which items consistently over-prep (leftover > 0) so they can dial
 * the morning batch size in.
 *
 * SQL grouping (not JS) so we can cover any range without paging.
 * Day boundary = Jakarta wall clock — matches the dashboard + P&L.
 */
export const getPrepWasteReport = createServerFn({ method: 'POST' })
  .inputValidator(prepWasteReportSchema)
  .handler(async ({ data }): Promise<PrepWasteRow[]> => {
    const auth = await requirePOSAccess()
    // JUR-207: same gate as getPOSReport — cashiers with pos.read
    // (for /pos/sales history) can't pull tenant-wide prep waste.
    if (!auth.permissions.includes('pos.report.view')) {
      throw new Error(
        'Anda tidak memiliki akses ke laporan POS. Hubungi pemilik.',
      )
    }
    // Tier gate matches the rest of POS reporting. Free tenants don't
    // get the report (and shouldn't have prep batches anyway since
    // recordPrepBatch is also gated).
    if (!posTierLimits(auth.posTier).features.includes('pl_report')) {
      throw new Error('Laporan ini tersedia mulai paket Toko.')
    }

    // dateTo is treated as INCLUSIVE — we add a day to make the SQL
    // half-open. Same idiom as the P&L report.
    const branchFilter = data.branchId
      ? sql`AND b.branch_id = ${data.branchId}`
      : sql``

    const rows = await db.execute<{
      day: string
      item_id: string
      item_name: string
      branch_id: string
      branch_name: string
      base_unit_label: string
      qty_prepared: string
      qty_consumed: string
      qty_leftover: string
    }>(sql`
      SELECT
        to_char((b.prepared_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS day,
        b.item_id,
        i.name AS item_name,
        b.branch_id,
        br.name AS branch_name,
        u.label AS base_unit_label,
        SUM(b.qty_prepared)::text AS qty_prepared,
        SUM(b.qty_consumed)::text AS qty_consumed,
        SUM(b.qty_prepared - b.qty_consumed)::text AS qty_leftover
      FROM inventory_item_prep_batches b
      JOIN inventory_items i ON i.id = b.item_id
      JOIN branches br ON br.id = b.branch_id
      JOIN master_hpp_units u ON u.id = i.base_unit_id
      WHERE b.tenant_id = ${auth.tenantId}
        AND (b.prepared_at AT TIME ZONE 'Asia/Jakarta')::date >= ${data.dateFrom}::date
        AND (b.prepared_at AT TIME ZONE 'Asia/Jakarta')::date <= ${data.dateTo}::date
        ${branchFilter}
      GROUP BY day, b.item_id, i.name, b.branch_id, br.name, u.label
      ORDER BY day DESC, i.name ASC
    `)

    return rows.map((r) => ({
      day: r.day,
      itemId: r.item_id,
      itemName: r.item_name,
      branchId: r.branch_id,
      branchName: r.branch_name,
      baseUnitLabel: r.base_unit_label,
      qtyPrepared: Number(r.qty_prepared),
      qtyConsumed: Number(r.qty_consumed),
      qtyLeftover: Number(r.qty_leftover),
    }))
  })

