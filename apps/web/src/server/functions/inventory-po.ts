/**
 * Toko-tier inventory features: multi-unit conversions + purchase
 * orders. Split from inventory.ts so the file size stays sane and
 * Free-tier code paths don't pull in PO state machinery.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  inventoryItems,
  inventoryItemUnits,
  inventoryItemUnitPricing,
  inventoryStockBalances,
  inventoryMovements,
  purchaseOrders,
  purchaseOrderItems,
  purchaseOrderCounters,
  purchaseOrderPayments,
  branches,
  suppliers,
  masterHppUnits,
  cashflowEntries,
} from '@vintra/db/schema'
import { and, eq, ne, sql, desc, inArray, gte, lt, or, ilike } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { inventoryTierLimits } from '@vintra/shared'
import {
  requireInventoryAccess,
  tenantHasCashflow,
} from '../middleware/module-access'
import {
  getSystemCategoryId,
  getDefaultAccountId,
} from '../lib/cashflow-sync'
import { formatRupiah } from '../../lib/currency'
import { PO_PAYMENT_METHODS, poRemainingAmount } from '../../lib/po-payment'
import {
  assertBranchAllowed,
  branchScopeWhere,
} from '../lib/branch-scope'

// ─── Unit conversions ──────────────────────────────────────────
// `addUnitConversion` / `removeUnitConversion` were renamed to
// `addItemUnit` / `removeItemUnit` and moved to `inventory.ts` as
// part of the per-unit pricing migration (see 0019). The legacy
// names are kept here as thin re-exports so existing call sites
// (item detail page) keep working until they migrate to the new
// editor in a follow-up.

// ─── Purchase order counter ──────────────────────────────────────────

/**
 * Atomic per-tenant PO number. Format: PO-{YYYY}-{0001}.
 *
 * Same pattern as the financial invoice counter — INSERT on conflict
 * UPDATE returning the next sequence in one round-trip. Counter resets
 * per calendar year (Jakarta time).
 */
async function nextPoNumber(tenantId: string): Promise<string> {
  const year = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCFullYear() // Jakarta year
  const [row] = await db.execute<{ next_seq: number }>(sql`
    INSERT INTO purchase_order_counters (tenant_id, year, next_seq)
    VALUES (${tenantId}, ${year}, 2)
    ON CONFLICT (tenant_id) DO UPDATE
      SET year = CASE
                   WHEN purchase_order_counters.year = ${year}
                     THEN purchase_order_counters.year
                   ELSE ${year}
                 END,
          next_seq = CASE
                       WHEN purchase_order_counters.year = ${year}
                         THEN purchase_order_counters.next_seq + 1
                       ELSE 2
                     END
    RETURNING (next_seq - 1) AS next_seq
  `)
  const seq = row?.next_seq ?? 1
  return `PO-${year}-${String(seq).padStart(4, '0')}`
}

// ─── Purchase order CRUD ─────────────────────────────────────────────

const poLineSchema = z.object({
  itemId: z.string().uuid(),
  /**
   * Ordered unit — one of the item's `inventory_item_units`. Omitted /
   * null = the item's base unit (legacy callers). orderedQty, unitCost,
   * subtotal and sellingPrice are all expressed in THIS unit.
   */
  unitId: z.string().uuid().optional().nullable(),
  orderedQty: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  /**
   * Optional money snapshot — when supplied, the server uses it
   * verbatim as the line subtotal AND derives a higher-precision
   * unit_cost from it (subtotal / qty). This kills the rounding
   * pain when a tenant buys packs (1 gallon = 19000 ml @ Rp 6.000)
   * but the per-base-unit price (Rp 0,32) doesn't multiply back
   * cleanly. Falls back to qty × unitCost when omitted.
   */
  subtotal: z.coerce.number().min(0).optional().nullable(),
  /**
   * Optional new selling price per base unit. When set + the line
   * gets received, `inventory_items.sellingPrice` is updated to this
   * value. Leave undefined for "no change" (most non-reseller flows).
   */
  sellingPrice: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().max(200).optional().nullable(),
})

const createPoSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  expectedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: z.string().max(1000).optional().nullable(),
  lines: z.array(poLineSchema).min(1, 'Minimal 1 baris item'),
})

function assertPoFeatureAvailable(tier: string) {
  if (tier === 'free') {
    throw new Error('Purchase Order hanya tersedia di paket Toko ke atas.')
  }
}

export const createPurchaseOrder = createServerFn({ method: 'POST' })
  .inputValidator(createPoSchema)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)
    // JUR-135: PO is a write into a branch's ledger; gate the create.
    assertBranchAllowed(auth, data.branchId)

    // Per-line subtotal: use the user-supplied value when present
    // (truth from the receipt the cashier is holding) — otherwise
    // fall back to qty × unitCost. PO header subtotal is the sum.
    function lineSubtotal(l: typeof data.lines[number]): number {
      return l.subtotal != null ? l.subtotal : l.orderedQty * l.unitCost
    }
    const subtotal = data.lines.reduce(
      (acc, l) => acc + lineSubtotal(l),
      0,
    )

    // Resolve + validate the ordered unit per line. A line may pick any
    // of its item's units; we snapshot ratioToBase so a later edit to
    // the unit definition can't shift this in-flight PO.
    const itemIds = [...new Set(data.lines.map((l) => l.itemId))]
    const unitRows = await db
      .select({
        itemId: inventoryItemUnits.itemId,
        unitId: inventoryItemUnits.unitId,
        ratioToBase: inventoryItemUnits.ratioToBase,
      })
      .from(inventoryItemUnits)
      .where(
        and(
          eq(inventoryItemUnits.tenantId, auth.tenantId),
          inArray(inventoryItemUnits.itemId, itemIds),
        ),
      )
    const ratioByItemUnit = new Map(
      unitRows.map((u) => [`${u.itemId}:${u.unitId}`, Number(u.ratioToBase)]),
    )
    function lineUnit(l: typeof data.lines[number]): {
      unitId: string | null
      unitRatio: number | null
    } {
      if (!l.unitId) return { unitId: null, unitRatio: null }
      const ratio = ratioByItemUnit.get(`${l.itemId}:${l.unitId}`)
      if (ratio == null) {
        throw new Error('Unit yang dipilih tidak tersedia untuk item ini.')
      }
      return { unitId: l.unitId, unitRatio: ratio }
    }
    // Validate every line up-front so a bad unit fails before insert.
    const resolvedUnits = data.lines.map(lineUnit)

    const result = await db.transaction(async (tx) => {
      const poNumber = await nextPoNumber(auth.tenantId)
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: auth.tenantId,
          poNumber,
          supplierId: data.supplierId,
          branchId: data.branchId,
          status: 'draft',
          expectedAt: data.expectedAt ?? null,
          subtotal: subtotal.toString(),
          notes: data.notes ?? null,
          createdBy: auth.userId,
        })
        .returning()

      await tx.insert(purchaseOrderItems).values(
        data.lines.map((l, i) => {
          // Subtotal = user truth when supplied; recompute otherwise.
          // unit_cost is back-derived from the truthful subtotal so
          // `qty × unit_cost ≈ subtotal` holds at higher precision
          // than the user-typed 2-decimal entry. Display rounding
          // happens in the UI; ledger keeps the precise value.
          const sub = lineSubtotal(l)
          const derivedUnitCost =
            l.subtotal != null && l.orderedQty > 0
              ? l.subtotal / l.orderedQty
              : l.unitCost
          const u = resolvedUnits[i]!
          return {
            purchaseOrderId: po!.id,
            itemId: l.itemId,
            unitId: u.unitId,
            unitRatio: u.unitRatio != null ? u.unitRatio.toString() : null,
            orderedQty: l.orderedQty.toString(),
            unitCost: derivedUnitCost.toString(),
            sellingPrice:
              l.sellingPrice != null ? l.sellingPrice.toString() : null,
            subtotal: sub.toString(),
            notes: l.notes ?? null,
          }
        }),
      )

      return po
    })

    return result
  })

export const sendPurchaseOrder = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)
    const [updated] = await db
      .update(purchaseOrders)
      .set({ status: 'sent', updatedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.id, data.id),
          eq(purchaseOrders.tenantId, auth.tenantId),
          eq(purchaseOrders.status, 'draft'),
          // JUR-135: 404-via-scope.
          branchScopeWhere(auth, purchaseOrders.branchId),
        ),
      )
      .returning()
    if (!updated) {
      throw new Error('PO tidak ditemukan atau tidak dalam status draft.')
    }
    return updated
  })

export const cancelPurchaseOrder = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)
    const [updated] = await db
      .update(purchaseOrders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.id, data.id),
          eq(purchaseOrders.tenantId, auth.tenantId),
          inArray(purchaseOrders.status, ['draft', 'sent', 'partial']),
          // JUR-135: 404-via-scope.
          branchScopeWhere(auth, purchaseOrders.branchId),
        ),
      )
      .returning()
    if (!updated) throw new Error('PO tidak bisa dibatalkan dari status saat ini.')
    return updated
  })

const receivePoSchema = z.object({
  id: z.string().uuid(),
  lines: z
    .array(
      z.object({
        poItemId: z.string().uuid(),
        receivedQty: z.coerce.number().min(0),
      }),
    )
    .min(1),
})

/**
 * Per-line receive. Caller passes the cumulative `receivedQty` for each
 * line (we replace, not increment, so the UI can pre-fill with current
 * received then let the user edit). For each line whose received qty
 * grew vs. the previous value, we create an `in` movement and bump
 * the stock balance. PO status transitions:
 *   - all lines fully received → 'received'
 *   - any line partially received → 'partial'
 *   - all lines unchanged → no status change
 */
export const receivePurchaseOrder = createServerFn({ method: 'POST' })
  .inputValidator(receivePoSchema)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)

    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, data.id),
          eq(purchaseOrders.tenantId, auth.tenantId),
          // JUR-135: receiving a PO writes movements; gate it.
          branchScopeWhere(auth, purchaseOrders.branchId),
        ),
      )
      .limit(1)
    if (!po) throw new Error('PO tidak ditemukan')
    if (po.status === 'cancelled' || po.status === 'received') {
      throw new Error(`PO dengan status "${po.status}" tidak bisa diterima.`)
    }

    const lines = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, data.id))

    const linesById = new Map(lines.map((l) => [l.id, l]))

    return await db.transaction(async (tx) => {
      const now = new Date()
      let allReceived = true
      let anyReceivedThisCall = false

      for (const update of data.lines) {
        const line = linesById.get(update.poItemId)
        if (!line) continue

        const ordered = Number(line.orderedQty)
        const previouslyReceived = Number(line.receivedQty)
        const newReceived = Math.min(update.receivedQty, ordered)
        const delta = newReceived - previouslyReceived

        // ordered_qty / received_qty / unit_cost are in the ordered
        // unit; stock + movements are always in the base unit. Convert
        // via the snapshotted ratio (null = 1 = base unit).
        const ratio = line.unitRatio != null ? Number(line.unitRatio) : 1
        const baseDelta = delta * ratio

        if (delta > 0) {
          anyReceivedThisCall = true
          // `in` movement — quantity + cost in base-unit terms so HPP
          // cost sync and balances stay consistent across the system.
          await tx.insert(inventoryMovements).values({
            tenantId: auth.tenantId,
            itemId: line.itemId,
            branchId: po.branchId,
            movementType: 'in',
            quantity: baseDelta.toString(),
            unitCost: (Number(line.unitCost) / ratio).toString(),
            reason: 'Penerimaan PO',
            referenceType: 'purchase_order',
            referenceId: po.id,
            performedBy: auth.userId,
          })

          // Upsert balance.
          const [existing] = await tx
            .select()
            .from(inventoryStockBalances)
            .where(
              and(
                eq(inventoryStockBalances.itemId, line.itemId),
                eq(inventoryStockBalances.branchId, po.branchId),
              ),
            )
            .limit(1)
          if (existing) {
            await tx
              .update(inventoryStockBalances)
              .set({
                quantity: (Number(existing.quantity) + baseDelta).toString(),
                lastMovementAt: now,
                updatedAt: now,
              })
              .where(eq(inventoryStockBalances.id, existing.id))
          } else {
            await tx.insert(inventoryStockBalances).values({
              tenantId: auth.tenantId,
              itemId: line.itemId,
              branchId: po.branchId,
              quantity: baseDelta.toString(),
              lastMovementAt: now,
            })
          }
        }

        if (newReceived !== previouslyReceived) {
          await tx
            .update(purchaseOrderItems)
            .set({ receivedQty: newReceived.toString() })
            .where(eq(purchaseOrderItems.id, line.id))
        }

        // Reseller workflow: if this PO line carried a new selling
        // price AND we received some on this call, upsert the tier-1
        // price for the ORDERED unit — the price the user typed is
        // "per ordered unit" (e.g. Rp/Botol). Legacy lines with no
        // unit fall back to the item's base unit.
        if (delta > 0 && line.sellingPrice != null) {
          const [itemMeta] = await tx
            .select({ baseUnitId: inventoryItems.baseUnitId })
            .from(inventoryItems)
            .where(eq(inventoryItems.id, line.itemId))
            .limit(1)
          if (itemMeta) {
            const priceUnitId = line.unitId ?? itemMeta.baseUnitId
            // Safety net: make sure the (item, base_unit) row exists
            // for items created pre-0019 that weren't seeded. An
            // ordered alt-unit row already exists (validated at PO
            // create), so this only matters for the base-unit case.
            await tx
              .insert(inventoryItemUnits)
              .values({
                tenantId: auth.tenantId,
                itemId: line.itemId,
                unitId: itemMeta.baseUnitId,
                ratioToBase: '1',
                sortOrder: 0,
              })
              .onConflictDoNothing({
                target: [inventoryItemUnits.itemId, inventoryItemUnits.unitId],
              })

            // Upsert the tier-1 price for the ordered unit.
            await tx
              .insert(inventoryItemUnitPricing)
              .values({
                tenantId: auth.tenantId,
                itemId: line.itemId,
                unitId: priceUnitId,
                minQty: '1',
                unitPrice: line.sellingPrice,
                sortOrder: 0,
              })
              .onConflictDoUpdate({
                target: [
                  inventoryItemUnitPricing.itemId,
                  inventoryItemUnitPricing.unitId,
                  inventoryItemUnitPricing.minQty,
                ],
                set: {
                  unitPrice: line.sellingPrice,
                  updatedAt: now,
                },
              })
          }
        }

        if (newReceived < ordered) allReceived = false
      }

      let newStatus: typeof po.status = po.status
      if (allReceived) newStatus = 'received'
      else if (anyReceivedThisCall || po.status === 'sent') newStatus = 'partial'

      const [updated] = await tx
        .update(purchaseOrders)
        .set({
          status: newStatus,
          receivedAt: allReceived ? now : po.receivedAt,
          updatedAt: now,
        })
        .where(eq(purchaseOrders.id, po.id))
        .returning()
      return updated
    })
  })

// ─── PO list + detail ────────────────────────────────────────────────

/** Total paid so far on a PO — correlated so list queries stay one round-trip. */
const poPaidAmountSql = sql<string>`(
  SELECT coalesce(sum(${purchaseOrderPayments.amount}), 0)
  FROM ${purchaseOrderPayments}
  WHERE ${purchaseOrderPayments.purchaseOrderId} = ${purchaseOrders.id}
)`

const listPoInput = z.object({
  status: z
    .enum(['draft', 'sent', 'partial', 'received', 'cancelled'])
    .optional(),
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export const listPurchaseOrders = createServerFn({ method: 'POST' })
  .inputValidator(listPoInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)

    const conds = [eq(purchaseOrders.tenantId, auth.tenantId)]
    if (data.status) conds.push(eq(purchaseOrders.status, data.status))
    if (data.supplierId)
      conds.push(eq(purchaseOrders.supplierId, data.supplierId))
    if (data.branchId) {
      // JUR-135: explicit branch filter — gate it.
      assertBranchAllowed(auth, data.branchId)
      conds.push(eq(purchaseOrders.branchId, data.branchId))
    } else {
      const scope = branchScopeWhere(auth, purchaseOrders.branchId)
      if (scope) conds.push(scope)
    }

    const offset = (data.page - 1) * data.pageSize
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          status: purchaseOrders.status,
          subtotal: purchaseOrders.subtotal,
          paidAmount: poPaidAmountSql,
          expectedAt: purchaseOrders.expectedAt,
          createdAt: purchaseOrders.createdAt,
          supplierName: suppliers.name,
          branchName: branches.name,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .innerJoin(branches, eq(purchaseOrders.branchId, branches.id))
        .where(and(...conds))
        .orderBy(desc(purchaseOrders.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(and(...conds)),
    ])

    return {
      items: rows.map((r) => ({
        ...r,
        subtotal: Number(r.subtotal),
        paidAmount: Number(r.paidAmount),
      })),
      total: totalRow[0]?.count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

export const getPurchaseOrder = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)

    const [po] = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        subtotal: purchaseOrders.subtotal,
        expectedAt: purchaseOrders.expectedAt,
        receivedAt: purchaseOrders.receivedAt,
        notes: purchaseOrders.notes,
        createdAt: purchaseOrders.createdAt,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        branchId: purchaseOrders.branchId,
        branchName: branches.name,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .innerJoin(branches, eq(purchaseOrders.branchId, branches.id))
      .where(
        and(
          eq(purchaseOrders.id, data.id),
          eq(purchaseOrders.tenantId, auth.tenantId),
          // JUR-135: 404-via-scope.
          branchScopeWhere(auth, purchaseOrders.branchId),
        ),
      )
      .limit(1)
    if (!po) throw new Error('PO tidak ditemukan')

    // Second master_hpp_units join, aliased, for the ordered unit —
    // distinct from the base unit join above.
    const orderedUnit = alias(masterHppUnits, 'po_ordered_unit')
    const lines = await db
      .select({
        id: purchaseOrderItems.id,
        itemId: purchaseOrderItems.itemId,
        itemName: inventoryItems.name,
        orderedQty: purchaseOrderItems.orderedQty,
        receivedQty: purchaseOrderItems.receivedQty,
        unitCost: purchaseOrderItems.unitCost,
        sellingPrice: purchaseOrderItems.sellingPrice,
        subtotal: purchaseOrderItems.subtotal,
        notes: purchaseOrderItems.notes,
        baseUnitLabel: masterHppUnits.label,
        unitId: purchaseOrderItems.unitId,
        unitRatio: purchaseOrderItems.unitRatio,
        orderedUnitLabel: orderedUnit.label,
      })
      .from(purchaseOrderItems)
      .innerJoin(
        inventoryItems,
        eq(purchaseOrderItems.itemId, inventoryItems.id),
      )
      .innerJoin(masterHppUnits, eq(inventoryItems.baseUnitId, masterHppUnits.id))
      .leftJoin(orderedUnit, eq(purchaseOrderItems.unitId, orderedUnit.id))
      .where(eq(purchaseOrderItems.purchaseOrderId, data.id))

    const payments = await db
      .select({
        id: purchaseOrderPayments.id,
        amount: purchaseOrderPayments.amount,
        method: purchaseOrderPayments.method,
        paidAt: purchaseOrderPayments.paidAt,
        note: purchaseOrderPayments.note,
        createdAt: purchaseOrderPayments.createdAt,
      })
      .from(purchaseOrderPayments)
      .where(eq(purchaseOrderPayments.purchaseOrderId, data.id))
      .orderBy(
        desc(purchaseOrderPayments.paidAt),
        desc(purchaseOrderPayments.createdAt),
      )

    return {
      ...po,
      subtotal: Number(po.subtotal),
      paidAmount: payments.reduce((acc, p) => acc + Number(p.amount), 0),
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      lines: lines.map((l) => ({
        ...l,
        orderedQty: Number(l.orderedQty),
        receivedQty: Number(l.receivedQty),
        unitCost: Number(l.unitCost),
        sellingPrice: l.sellingPrice != null ? Number(l.sellingPrice) : null,
        subtotal: Number(l.subtotal),
        unitRatio: l.unitRatio != null ? Number(l.unitRatio) : 1,
        // The unit a PO line was ordered in — falls back to the item's
        // base unit for legacy rows with no explicit unit.
        unitLabel: l.orderedUnitLabel ?? l.baseUnitLabel,
      })),
    }
  })

// ─── PO Excel export ─────────────────────────────────────────────────

/** Hard cap on POs per export so one download stays a bounded query. */
const PO_EXPORT_LIMIT = 2000

const exportPoInput = z.object({
  status: z
    .enum(['draft', 'sent', 'partial', 'received', 'cancelled'])
    .optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
  branchId: z.string().uuid().optional(),
  supplierName: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

/**
 * Every PO matching the list page's filters, with ALL of its lines, for
 * the Excel download. The list page only loads 50 POs and filters them
 * in the browser; exporting that would silently drop older orders, so
 * the filters are re-applied here against the full table instead.
 */
export const exportPurchaseOrders = createServerFn({ method: 'POST' })
  .inputValidator(exportPoInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)

    const conds = [eq(purchaseOrders.tenantId, auth.tenantId)]
    if (data.status) conds.push(eq(purchaseOrders.status, data.status))
    if (data.supplierName) conds.push(eq(suppliers.name, data.supplierName))
    if (data.branchId) {
      // JUR-135: explicit branch filter — gate it.
      assertBranchAllowed(auth, data.branchId)
      conds.push(eq(purchaseOrders.branchId, data.branchId))
    } else {
      const scope = branchScopeWhere(auth, purchaseOrders.branchId)
      if (scope) conds.push(scope)
    }
    // Date bounds are Jakarta calendar days — the same days the list
    // renders via formatDate.
    if (data.dateFrom) {
      conds.push(
        gte(purchaseOrders.createdAt, new Date(`${data.dateFrom}T00:00:00+07:00`)),
      )
    }
    if (data.dateTo) {
      const dayAfter = new Date(`${data.dateTo}T00:00:00+07:00`)
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
      conds.push(lt(purchaseOrders.createdAt, dayAfter))
    }
    const q = data.search?.trim()
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
      conds.push(
        or(
          ilike(purchaseOrders.poNumber, pattern),
          ilike(suppliers.name, pattern),
          ilike(branches.name, pattern),
        )!,
      )
    }

    // Same rules as poPaymentStatus(): cancelled POs carry no payment
    // status, and a zero-value PO counts as paid.
    if (data.paymentStatus) {
      conds.push(ne(purchaseOrders.status, 'cancelled'))
      if (data.paymentStatus === 'unpaid') {
        conds.push(
          sql`${poPaidAmountSql} = 0 AND ${purchaseOrders.subtotal} > 0`,
        )
      } else if (data.paymentStatus === 'partial') {
        conds.push(
          sql`${poPaidAmountSql} > 0 AND ${poPaidAmountSql} < ${purchaseOrders.subtotal}`,
        )
      } else {
        conds.push(sql`${poPaidAmountSql} >= ${purchaseOrders.subtotal}`)
      }
    }

    const orderRows = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        subtotal: purchaseOrders.subtotal,
        paidAmount: poPaidAmountSql,
        expectedAt: purchaseOrders.expectedAt,
        createdAt: purchaseOrders.createdAt,
        supplierName: suppliers.name,
        branchName: branches.name,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .innerJoin(branches, eq(purchaseOrders.branchId, branches.id))
      .where(and(...conds))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(PO_EXPORT_LIMIT + 1)

    const truncated = orderRows.length > PO_EXPORT_LIMIT
    const orders = orderRows.slice(0, PO_EXPORT_LIMIT)
    const poIds = orders.map((o) => o.id)

    // Same aliased second unit join as getPurchaseOrder.
    const orderedUnit = alias(masterHppUnits, 'po_ordered_unit')
    const lineRows = poIds.length
      ? await db
          .select({
            purchaseOrderId: purchaseOrderItems.purchaseOrderId,
            itemName: inventoryItems.name,
            sku: inventoryItems.sku,
            orderedQty: purchaseOrderItems.orderedQty,
            receivedQty: purchaseOrderItems.receivedQty,
            unitCost: purchaseOrderItems.unitCost,
            sellingPrice: purchaseOrderItems.sellingPrice,
            subtotal: purchaseOrderItems.subtotal,
            notes: purchaseOrderItems.notes,
            unitRatio: purchaseOrderItems.unitRatio,
            baseUnitLabel: masterHppUnits.label,
            orderedUnitLabel: orderedUnit.label,
          })
          .from(purchaseOrderItems)
          .innerJoin(
            inventoryItems,
            eq(purchaseOrderItems.itemId, inventoryItems.id),
          )
          .innerJoin(
            masterHppUnits,
            eq(inventoryItems.baseUnitId, masterHppUnits.id),
          )
          .leftJoin(orderedUnit, eq(purchaseOrderItems.unitId, orderedUnit.id))
          .where(inArray(purchaseOrderItems.purchaseOrderId, poIds))
          .orderBy(inventoryItems.name)
      : []

    return {
      orders: orders.map((o) => ({
        ...o,
        subtotal: Number(o.subtotal),
        paidAmount: Number(o.paidAmount),
      })),
      lines: lineRows.map((l) => ({
        purchaseOrderId: l.purchaseOrderId,
        itemName: l.itemName,
        sku: l.sku,
        orderedQty: Number(l.orderedQty),
        receivedQty: Number(l.receivedQty),
        unitCost: Number(l.unitCost),
        sellingPrice: l.sellingPrice != null ? Number(l.sellingPrice) : null,
        subtotal: Number(l.subtotal),
        notes: l.notes,
        unitRatio: l.unitRatio != null ? Number(l.unitRatio) : 1,
        unitLabel: l.orderedUnitLabel ?? l.baseUnitLabel,
        baseUnitLabel: l.baseUnitLabel,
      })),
      truncated,
      limit: PO_EXPORT_LIMIT,
    }
  })

// ─── PO payments ─────────────────────────────────────────────────────

/** System cashflow category PO payments post to (seeded in 0130). */
const PO_PAYMENT_CATEGORY = 'Pembelian dari Supplier'

const recordPoPaymentInput = z.object({
  purchaseOrderId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  method: z.enum(PO_PAYMENT_METHODS),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional().nullable(),
})

/**
 * Record money paid to the supplier against a PO. Refuses a cancelled
 * PO and anything above what is still outstanding.
 *
 * When the tenant's plan includes Cashflow, the payment is mirrored as a
 * `po_payment` expense so the cash balance drops without a second manual
 * entry. The Cashflow ledger refuses to edit non-manual rows, so that
 * entry is only ever removed through `deletePoPayment`.
 */
export const recordPoPayment = createServerFn({ method: 'POST' })
  .inputValidator(recordPoPaymentInput)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)

    const [po] = await db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        subtotal: purchaseOrders.subtotal,
        branchId: purchaseOrders.branchId,
        supplierName: suppliers.name,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          eq(purchaseOrders.id, data.purchaseOrderId),
          eq(purchaseOrders.tenantId, auth.tenantId),
          // JUR-135: 404-via-scope.
          branchScopeWhere(auth, purchaseOrders.branchId),
        ),
      )
      .limit(1)
    if (!po) throw new Error('PO tidak ditemukan')
    if (po.status === 'cancelled') {
      throw new Error('PO yang sudah dibatalkan tidak bisa dibayar.')
    }

    // Resolve the ledger target before taking the PO lock — these lookups
    // are cached and may seed the tenant's default account.
    let ledger: { accountId: string; categoryId: string } | null = null
    if (await tenantHasCashflow(auth.tenantId)) {
      const categoryId =
        (await getSystemCategoryId(PO_PAYMENT_CATEGORY, 'expense')) ??
        (await getSystemCategoryId('Lain-lain', 'expense'))
      if (categoryId) {
        // Default account for every method, like every other cashflow
        // writer here — Vintra has no per-branch cash pots.
        const accountId = await getDefaultAccountId(auth.tenantId)
        ledger = { accountId, categoryId }
      }
    }

    return await db.transaction(async (tx) => {
      // Lock the PO row so two payments submitted together can't both
      // pass the outstanding check and overpay.
      await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, po.id))
        .for('update')
      const [paidRow] = await tx
        .select({
          paid: sql<string>`coalesce(sum(${purchaseOrderPayments.amount}), 0)`,
        })
        .from(purchaseOrderPayments)
        .where(eq(purchaseOrderPayments.purchaseOrderId, po.id))
      const remaining = poRemainingAmount({
        subtotal: Number(po.subtotal),
        paidAmount: Number(paidRow?.paid ?? 0),
      })
      if (data.amount > remaining + 0.005) {
        throw new Error(
          remaining > 0
            ? `Jumlah melebihi sisa tagihan (${formatRupiah(remaining)}).`
            : 'PO ini sudah lunas.',
        )
      }

      const [payment] = await tx
        .insert(purchaseOrderPayments)
        .values({
          tenantId: auth.tenantId,
          purchaseOrderId: po.id,
          amount: data.amount.toString(),
          method: data.method,
          paidAt: data.paidAt,
          note: data.note || null,
          recordedByUserId: auth.userId,
        })
        .returning()

      if (ledger) {
        await tx.insert(cashflowEntries).values({
          tenantId: auth.tenantId,
          branchId: po.branchId,
          accountId: ledger.accountId,
          type: 'expense',
          categoryId: ledger.categoryId,
          amount: data.amount.toString(),
          date: data.paidAt,
          source: 'po_payment',
          sourceRef: payment!.id,
          note: `Pembayaran ${po.poNumber} · ${po.supplierName}`,
          createdByUserId: auth.userId,
        })
      }

      return payment
    })
  })

/** Remove a mistaken payment together with its mirrored cashflow entry. */
export const deletePoPayment = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertPoFeatureAvailable(auth.inventoryTier)

    const [row] = await db
      .select({ id: purchaseOrderPayments.id })
      .from(purchaseOrderPayments)
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrderPayments.purchaseOrderId, purchaseOrders.id),
      )
      .where(
        and(
          eq(purchaseOrderPayments.id, data.id),
          eq(purchaseOrderPayments.tenantId, auth.tenantId),
          // JUR-135: 404-via-scope.
          branchScopeWhere(auth, purchaseOrders.branchId),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Pembayaran tidak ditemukan.')

    await db.transaction(async (tx) => {
      await tx
        .delete(cashflowEntries)
        .where(
          and(
            eq(cashflowEntries.tenantId, auth.tenantId),
            eq(cashflowEntries.source, 'po_payment'),
            eq(cashflowEntries.sourceRef, data.id),
          ),
        )
      await tx
        .delete(purchaseOrderPayments)
        .where(eq(purchaseOrderPayments.id, data.id))
    })
    return { ok: true }
  })

// ─── PO form data ────────────────────────────────────────────────────

/**
 * Inventory items + each item's units, for the create-PO item picker.
 * Lets a PO line be ordered in any of the item's units (base or alt),
 * which listInventoryItems (base unit only) can't express.
 */
export const listItemsForPO = createServerFn().handler(async () => {
  const auth = await requireInventoryAccess()
  assertPoFeatureAvailable(auth.inventoryTier)

  const items = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      costPrice: inventoryItems.costPrice,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, auth.tenantId),
        eq(inventoryItems.isActive, true),
      ),
    )
    .orderBy(inventoryItems.name)

  const itemIds = items.map((i) => i.id)
  const unitRows = itemIds.length
    ? await db
        .select({
          itemId: inventoryItemUnits.itemId,
          unitId: inventoryItemUnits.unitId,
          label: masterHppUnits.label,
          ratioToBase: inventoryItemUnits.ratioToBase,
          isDefault: inventoryItemUnits.isDefault,
        })
        .from(inventoryItemUnits)
        .innerJoin(
          masterHppUnits,
          eq(masterHppUnits.id, inventoryItemUnits.unitId),
        )
        .where(inArray(inventoryItemUnits.itemId, itemIds))
        .orderBy(inventoryItemUnits.sortOrder)
    : []

  const unitsByItem = new Map<
    string,
    {
      unitId: string
      label: string
      ratioToBase: number
      isDefault: boolean
    }[]
  >()
  for (const u of unitRows) {
    const list = unitsByItem.get(u.itemId) ?? []
    list.push({
      unitId: u.unitId,
      label: u.label,
      ratioToBase: Number(u.ratioToBase),
      isDefault: u.isDefault,
    })
    unitsByItem.set(u.itemId, list)
  }

  return items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    /** Base-unit cost — the create-PO form scales it by the chosen
     *  unit's ratio for the unit-cost pre-fill. */
    costPrice: Number(i.costPrice),
    units: unitsByItem.get(i.id) ?? [],
  }))
})
