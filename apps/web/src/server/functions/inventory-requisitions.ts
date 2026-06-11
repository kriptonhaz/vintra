/**
 * Inter-branch stock requisitions (JUR-190). An outlet branch requests
 * stock from the main branch; the main branch approves, then fulfills.
 * Fulfillment moves stock between branches via paired transfer_out /
 * transfer_in `inventory_movements` + balance upserts.
 *
 * Structurally mirrors the purchase-order flow (`inventory-po.ts`):
 * header + lines, an atomic per-tenant number counter, status machine,
 * and the receive→stock-write pattern (here applied as a transfer).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  inventoryItems,
  inventoryItemUnits,
  inventoryStockBalances,
  inventoryMovements,
  stockRequisitions,
  stockRequisitionItems,
  branches,
  masterHppUnits,
  tenantCategories,
  tenants,
  notifications,
} from '@vintra/db/schema'
import { and, eq, or, isNull, sql, desc, inArray } from 'drizzle-orm'
import { requireInventoryAccess } from '../middleware/module-access'
import { assertBranchAllowed } from '../lib/branch-scope'
import { writeRequisitionCashflowEntries } from '../lib/cashflow-sync'

// ─── Tier gate ───────────────────────────────────────────────────────

function assertRequisitionFeatureAvailable(tier: string) {
  if (tier === 'free') {
    throw new Error(
      'Permintaan stok antar cabang tersedia di paket Toko ke atas.',
    )
  }
}

// ─── Requisition number counter ──────────────────────────────────────

/**
 * Atomic per-tenant requisition number. Format: REQ-{YYYY}-{0001}.
 * Same INSERT-on-conflict pattern as `nextPoNumber`; resets per
 * calendar year (Jakarta time).
 */
async function nextRequisitionNumber(tenantId: string): Promise<string> {
  const year = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCFullYear()
  const [row] = await db.execute<{ next_seq: number }>(sql`
    INSERT INTO stock_requisition_counters (tenant_id, year, next_seq)
    VALUES (${tenantId}, ${year}, 2)
    ON CONFLICT (tenant_id) DO UPDATE
      SET year = CASE
                   WHEN stock_requisition_counters.year = ${year}
                     THEN stock_requisition_counters.year
                   ELSE ${year}
                 END,
          next_seq = CASE
                       WHEN stock_requisition_counters.year = ${year}
                         THEN stock_requisition_counters.next_seq + 1
                       ELSE 2
                     END
    RETURNING (next_seq - 1) AS next_seq
  `)
  const seq = row?.next_seq ?? 1
  return `REQ-${year}-${String(seq).padStart(4, '0')}`
}

// ─── Create ──────────────────────────────────────────────────────────

const reqLineSchema = z.object({
  itemId: z.string().uuid(),
  /**
   * Ordered unit. Optional / null = the item's base unit. Mirrors the
   * PO line model so the form can show alt units like kg / liter.
   */
  unitId: z.string().uuid().optional().nullable(),
  requestedQty: z.coerce.number().positive(),
  notes: z.string().max(200).optional().nullable(),
})

const createRequisitionSchema = z.object({
  requestingBranchId: z.string().uuid(),
  notes: z.string().max(1000).optional().nullable(),
  lines: z.array(reqLineSchema).min(1, 'Minimal 1 baris item'),
})

export const createRequisition = createServerFn({ method: 'POST' })
  .inputValidator(createRequisitionSchema)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)
    // The outlet raising the request must have access to that branch.
    assertBranchAllowed(auth, data.requestingBranchId)

    // Resolve the requesting branch + the main branch (the fulfiller).
    const tenantBranches = await db
      .select({
        id: branches.id,
        name: branches.name,
        isMain: branches.isMain,
        branchModel: branches.branchModel,
      })
      .from(branches)
      .where(
        and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)),
      )
    const requestingBranch = tenantBranches.find(
      (b) => b.id === data.requestingBranchId,
    )
    const mainBranch = tenantBranches.find((b) => b.isMain)
    if (!requestingBranch) throw new Error('Cabang tidak ditemukan.')
    if (!mainBranch) {
      throw new Error(
        'Belum ada cabang utama. Tetapkan cabang utama dulu di Master Cabang.',
      )
    }
    if (requestingBranch.id === mainBranch.id) {
      throw new Error('Cabang utama tidak perlu membuat permintaan stok.')
    }

    // Franchise outlets buy stock from HQ — capture each line's price
    // from the item's franchise_price at requisition time. Independent
    // branches transfer stock with no money (unitPrice stays null).
    const isFranchise = requestingBranch.branchModel === 'franchise'
    const priceByItemId = new Map<string, string>()
    if (isFranchise) {
      const itemIds = data.lines.map((l) => l.itemId)
      const pricedItems = await db
        .select({
          id: inventoryItems.id,
          name: inventoryItems.name,
          franchisePrice: inventoryItems.franchisePrice,
        })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.tenantId, auth.tenantId),
            inArray(inventoryItems.id, itemIds),
          ),
        )
      const itemById = new Map(pricedItems.map((p) => [p.id, p]))
      for (const line of data.lines) {
        const item = itemById.get(line.itemId)
        if (!item) throw new Error('Item tidak ditemukan.')
        if (item.franchisePrice == null) {
          throw new Error(
            `Item "${item.name}" belum punya Harga Waralaba — atur dulu di Master Item sebelum dipesan outlet waralaba.`,
          )
        }
        priceByItemId.set(line.itemId, item.franchisePrice)
      }
    }

    // Snapshot the ratio for every (itemId, unitId) the user picked, so
    // fulfill can multiply qty→base without re-reading inventory_item_units
    // (which may have been edited between request and fulfilment).
    const unitPairs = data.lines
      .map((l) => ({ itemId: l.itemId, unitId: l.unitId ?? null }))
      .filter((p): p is { itemId: string; unitId: string } => p.unitId != null)
    const ratioByPair = new Map<string, string>()
    if (unitPairs.length > 0) {
      const rows = await db
        .select({
          itemId: inventoryItemUnits.itemId,
          unitId: inventoryItemUnits.unitId,
          ratioToBase: inventoryItemUnits.ratioToBase,
        })
        .from(inventoryItemUnits)
        .where(
          and(
            inArray(
              inventoryItemUnits.itemId,
              unitPairs.map((p) => p.itemId),
            ),
            inArray(
              inventoryItemUnits.unitId,
              unitPairs.map((p) => p.unitId),
            ),
          ),
        )
      for (const r of rows) {
        ratioByPair.set(`${r.itemId}:${r.unitId}`, r.ratioToBase)
      }
      for (const p of unitPairs) {
        if (!ratioByPair.has(`${p.itemId}:${p.unitId}`)) {
          throw new Error(
            'Salah satu unit yang dipilih tidak terdaftar untuk item tersebut.',
          )
        }
      }
    }

    const requisition = await db.transaction(async (tx) => {
      const requisitionNumber = await nextRequisitionNumber(auth.tenantId)
      const [header] = await tx
        .insert(stockRequisitions)
        .values({
          tenantId: auth.tenantId,
          requisitionNumber,
          requestingBranchId: requestingBranch.id,
          sourceBranchId: mainBranch.id,
          status: 'pending',
          notes: data.notes ?? null,
          requestedBy: auth.userId,
        })
        .returning()

      await tx.insert(stockRequisitionItems).values(
        data.lines.map((l) => ({
          requisitionId: header!.id,
          itemId: l.itemId,
          unitId: l.unitId ?? null,
          unitRatio:
            l.unitId != null
              ? (ratioByPair.get(`${l.itemId}:${l.unitId}`) ?? null)
              : null,
          requestedQty: l.requestedQty.toString(),
          unitPrice: priceByItemId.get(l.itemId) ?? null,
          notes: l.notes ?? null,
        })),
      )
      return header!
    })

    // Notify the tenant owner so the main branch knows a request landed.
    const [owner] = await db
      .select({ ownerId: tenants.ownerId })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1)
    if (owner?.ownerId) {
      await db
        .insert(notifications)
        .values({
          userId: owner.ownerId,
          tenantId: auth.tenantId,
          type: 'stock_requisition_raised',
          title: 'Permintaan stok baru',
          body: `${requestingBranch.name} mengajukan permintaan stok ${requisition.requisitionNumber}.`,
          url: `/inventory/requisitions/${requisition.id}`,
          sourceKey: `stock_requisition_raised:${requisition.id}`,
        })
        .onConflictDoNothing()
    }

    return requisition
  })

// ─── List ────────────────────────────────────────────────────────────

const listRequisitionsSchema = z.object({
  status: z
    .enum(['pending', 'approved', 'fulfilled', 'rejected', 'cancelled'])
    .optional(),
  /** Topbar branch switcher — show requisitions touching this branch. */
  branchId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export const listRequisitions = createServerFn({ method: 'POST' })
  .inputValidator(listRequisitionsSchema)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)

    const conds = [eq(stockRequisitions.tenantId, auth.tenantId)]
    if (data.status) conds.push(eq(stockRequisitions.status, data.status))
    // Topbar branch switcher: a requisition "touches" a branch when it
    // either requested the stock or is the fulfilling source.
    if (data.branchId) {
      assertBranchAllowed(auth, data.branchId)
      conds.push(
        or(
          eq(stockRequisitions.requestingBranchId, data.branchId),
          eq(stockRequisitions.sourceBranchId, data.branchId),
        )!,
      )
    }
    // Branch scoping: a scoped user sees requisitions touching one of
    // their branches on EITHER side (they requested it, or they're the
    // fulfilling branch). Unrestricted users (owner) see everything.
    if (auth.allowedBranchIds !== null) {
      const ids = auth.allowedBranchIds
      conds.push(
        or(
          inArray(stockRequisitions.requestingBranchId, ids),
          inArray(stockRequisitions.sourceBranchId, ids),
        )!,
      )
    }

    const requestingBranch = db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .as('requesting_branch')
    const sourceBranch = db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .as('source_branch')

    const offset = (data.page - 1) * data.pageSize
    const [rows, totalRow] = await Promise.all([
      db
        .select({
          id: stockRequisitions.id,
          requisitionNumber: stockRequisitions.requisitionNumber,
          status: stockRequisitions.status,
          requestingBranchName: requestingBranch.name,
          sourceBranchName: sourceBranch.name,
          createdAt: stockRequisitions.createdAt,
        })
        .from(stockRequisitions)
        .innerJoin(
          requestingBranch,
          eq(stockRequisitions.requestingBranchId, requestingBranch.id),
        )
        .innerJoin(
          sourceBranch,
          eq(stockRequisitions.sourceBranchId, sourceBranch.id),
        )
        .where(and(...conds))
        .orderBy(desc(stockRequisitions.createdAt))
        .limit(data.pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(stockRequisitions)
        .where(and(...conds)),
    ])

    return {
      items: rows,
      total: totalRow[0]?.count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

// ─── Detail ──────────────────────────────────────────────────────────

export const getRequisition = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)

    const requestingBranch = db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .as('requesting_branch')
    const sourceBranch = db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .as('source_branch')

    const [req] = await db
      .select({
        id: stockRequisitions.id,
        requisitionNumber: stockRequisitions.requisitionNumber,
        status: stockRequisitions.status,
        notes: stockRequisitions.notes,
        requestingBranchId: stockRequisitions.requestingBranchId,
        requestingBranchName: requestingBranch.name,
        sourceBranchId: stockRequisitions.sourceBranchId,
        sourceBranchName: sourceBranch.name,
        approvedAt: stockRequisitions.approvedAt,
        fulfilledAt: stockRequisitions.fulfilledAt,
        createdAt: stockRequisitions.createdAt,
      })
      .from(stockRequisitions)
      .innerJoin(
        requestingBranch,
        eq(stockRequisitions.requestingBranchId, requestingBranch.id),
      )
      .innerJoin(
        sourceBranch,
        eq(stockRequisitions.sourceBranchId, sourceBranch.id),
      )
      .where(
        and(
          eq(stockRequisitions.id, data.id),
          eq(stockRequisitions.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!req) throw new Error('Permintaan stok tidak ditemukan.')

    // Branch-scope read guard: the requisition must touch a branch the
    // caller can see (either side).
    if (auth.allowedBranchIds !== null) {
      const seen =
        auth.allowedBranchIds.includes(req.requestingBranchId) ||
        auth.allowedBranchIds.includes(req.sourceBranchId)
      if (!seen) throw new Error('Permintaan stok tidak ditemukan.')
    }

    const lines = await db
      .select({
        id: stockRequisitionItems.id,
        itemId: stockRequisitionItems.itemId,
        itemName: inventoryItems.name,
        requestedQty: stockRequisitionItems.requestedQty,
        fulfilledQty: stockRequisitionItems.fulfilledQty,
        unitPrice: stockRequisitionItems.unitPrice,
        notes: stockRequisitionItems.notes,
        unitId: stockRequisitionItems.unitId,
        unitRatio: stockRequisitionItems.unitRatio,
        baseUnitLabel: masterHppUnits.label,
        // Chosen unit label; falls back to the base unit's label at the
        // render layer when unit_id is NULL (legacy rows).
        chosenUnitLabel: sql<string | null>`(
          SELECT label FROM ${masterHppUnits}
          WHERE id = ${stockRequisitionItems.unitId}
        )`,
      })
      .from(stockRequisitionItems)
      .innerJoin(
        inventoryItems,
        eq(stockRequisitionItems.itemId, inventoryItems.id),
      )
      .innerJoin(
        masterHppUnits,
        eq(inventoryItems.baseUnitId, masterHppUnits.id),
      )
      .where(eq(stockRequisitionItems.requisitionId, data.id))

    const pricedLines = lines.map((l) => ({
      ...l,
      requestedQty: Number(l.requestedQty),
      fulfilledQty: Number(l.fulfilledQty),
      unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
      unitRatio: l.unitRatio != null ? Number(l.unitRatio) : 1,
      // Render-friendly label so callers don't repeat the fallback.
      unitLabel: l.chosenUnitLabel ?? l.baseUnitLabel,
    }))

    // Total cost of a franchise requisition (priced lines). 0 for an
    // independent transfer where every unitPrice is null. unitPrice is
    // per-base (franchise_price), so the line total is qty × ratio ×
    // price (= baseQty × price).
    const totalCost = pricedLines.reduce(
      (sum, l) => sum + (l.unitPrice ?? 0) * l.requestedQty * l.unitRatio,
      0,
    )

    return { ...req, lines: pricedLines, totalCost }
  })

// ─── Approve / reject / cancel ───────────────────────────────────────

/** Load a requisition + assert the caller can act on the source side. */
async function loadForSourceAction(
  auth: Awaited<ReturnType<typeof requireInventoryAccess>>,
  id: string,
) {
  const [req] = await db
    .select()
    .from(stockRequisitions)
    .where(
      and(
        eq(stockRequisitions.id, id),
        eq(stockRequisitions.tenantId, auth.tenantId),
      ),
    )
    .limit(1)
  if (!req) throw new Error('Permintaan stok tidak ditemukan.')
  // Only a user with access to the fulfilling (main) branch may
  // approve / reject / fulfill — this naturally blocks outlet-scoped
  // users from acting on the HQ side.
  assertBranchAllowed(auth, req.sourceBranchId)
  return req
}

/** Notify the original requester about a status change. */
async function notifyRequester(
  req: { id: string; requisitionNumber: string; requestedBy: string },
  tenantId: string,
  status: 'approved' | 'rejected' | 'fulfilled',
) {
  const label =
    status === 'approved'
      ? 'disetujui'
      : status === 'rejected'
        ? 'ditolak'
        : 'dipenuhi'
  await db
    .insert(notifications)
    .values({
      userId: req.requestedBy,
      tenantId,
      type: `stock_requisition_${status}`,
      title: `Permintaan stok ${label}`,
      body: `Permintaan stok ${req.requisitionNumber} telah ${label}.`,
      url: `/inventory/requisitions/${req.id}`,
      sourceKey: `stock_requisition_${status}:${req.id}`,
    })
    .onConflictDoNothing()
}

export const approveRequisition = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)
    const req = await loadForSourceAction(auth, data.id)
    if (req.status !== 'pending') {
      throw new Error('Hanya permintaan berstatus "menunggu" yang bisa disetujui.')
    }
    const [updated] = await db
      .update(stockRequisitions)
      .set({
        status: 'approved',
        approvedBy: auth.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stockRequisitions.id, req.id))
      .returning()
    await notifyRequester(req, auth.tenantId, 'approved')
    return updated
  })

export const rejectRequisition = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)
    const req = await loadForSourceAction(auth, data.id)
    if (req.status !== 'pending') {
      throw new Error('Hanya permintaan berstatus "menunggu" yang bisa ditolak.')
    }
    const [updated] = await db
      .update(stockRequisitions)
      .set({
        status: 'rejected',
        approvedBy: auth.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stockRequisitions.id, req.id))
      .returning()
    await notifyRequester(req, auth.tenantId, 'rejected')
    return updated
  })

export const cancelRequisition = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)
    const [req] = await db
      .select()
      .from(stockRequisitions)
      .where(
        and(
          eq(stockRequisitions.id, data.id),
          eq(stockRequisitions.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!req) throw new Error('Permintaan stok tidak ditemukan.')
    // The requesting branch withdraws its own request.
    assertBranchAllowed(auth, req.requestingBranchId)
    if (req.status !== 'pending') {
      throw new Error('Hanya permintaan berstatus "menunggu" yang bisa dibatalkan.')
    }
    const [updated] = await db
      .update(stockRequisitions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(stockRequisitions.id, req.id))
      .returning()
    return updated
  })

// ─── Fulfill ─────────────────────────────────────────────────────────

const fulfillSchema = z.object({
  id: z.string().uuid(),
  lines: z
    .array(
      z.object({
        requisitionItemId: z.string().uuid(),
        fulfilledQty: z.coerce.number().min(0),
      }),
    )
    .min(1),
})

/**
 * Fulfill an approved requisition. The fulfiller passes `fulfilledQty`
 * per line (may be less than requested — a shortfall is recorded on
 * the line). For each line with a positive quantity we move stock in
 * one transaction: a `transfer_out` movement + balance decrement on the
 * source branch, and a `transfer_in` movement + balance increment on
 * the requesting branch. One fulfill action closes the requisition.
 */
export const fulfillRequisition = createServerFn({ method: 'POST' })
  .inputValidator(fulfillSchema)
  .handler(async ({ data }) => {
    const auth = await requireInventoryAccess()
    assertRequisitionFeatureAvailable(auth.inventoryTier)
    const req = await loadForSourceAction(auth, data.id)
    if (req.status !== 'approved') {
      throw new Error(
        'Hanya permintaan berstatus "disetujui" yang bisa dipenuhi.',
      )
    }

    const lines = await db
      .select()
      .from(stockRequisitionItems)
      .where(eq(stockRequisitionItems.requisitionId, req.id))
    const linesById = new Map(lines.map((l) => [l.id, l]))

    const updated = await db.transaction(async (tx) => {
      const now = new Date()
      // Franchise requisitions carry a per-line unit_price — sum the
      // priced, actually-fulfilled quantities into the purchase total.
      // Stays 0 for an independent branch's plain transfer.
      let purchaseTotal = 0

      for (const input of data.lines) {
        const line = linesById.get(input.requisitionItemId)
        if (!line) continue
        const qty = Math.min(input.fulfilledQty, Number(line.requestedQty))
        if (!(qty > 0)) continue
        // qty is in the chosen unit (snapshot via `unitId`); the stock
        // ledger and balances are always base-unit, so apply the
        // snapshot ratio. NULL = legacy/base unit = 1.
        const ratio = line.unitRatio != null ? Number(line.unitRatio) : 1
        const baseQty = qty * ratio
        if (line.unitPrice != null) {
          // unitPrice is per-base (it's a snapshot of inventoryItems.franchisePrice),
          // so the purchase total uses the base qty.
          purchaseTotal += baseQty * Number(line.unitPrice)
        }

        // Move stock OUT of the source branch (always base-unit).
        await tx.insert(inventoryMovements).values({
          tenantId: auth.tenantId,
          itemId: line.itemId,
          branchId: req.sourceBranchId,
          movementType: 'transfer_out',
          quantity: baseQty.toString(),
          reason: 'Mutasi keluar',
          referenceType: 'transfer',
          referenceId: req.id,
          notes: `${req.requisitionNumber} → cabang tujuan`,
          performedBy: auth.userId,
        })
        await upsertBalance(tx, auth.tenantId, line.itemId, req.sourceBranchId, -baseQty, now)

        // Move stock IN to the requesting branch.
        await tx.insert(inventoryMovements).values({
          tenantId: auth.tenantId,
          itemId: line.itemId,
          branchId: req.requestingBranchId,
          movementType: 'transfer_in',
          quantity: baseQty.toString(),
          reason: 'Mutasi masuk',
          referenceType: 'transfer',
          referenceId: req.id,
          notes: `${req.requisitionNumber} ← cabang utama`,
          performedBy: auth.userId,
        })
        await upsertBalance(tx, auth.tenantId, line.itemId, req.requestingBranchId, baseQty, now)

        // fulfilledQty is stored in the SAME unit as requestedQty (the
        // chosen ordering unit) so the UI can render both with the same
        // label.
        await tx
          .update(stockRequisitionItems)
          .set({ fulfilledQty: qty.toString() })
          .where(eq(stockRequisitionItems.id, line.id))
      }

      const [header] = await tx
        .update(stockRequisitions)
        .set({ status: 'fulfilled', fulfilledAt: now, updatedAt: now })
        .where(eq(stockRequisitions.id, req.id))
        .returning()

      // Franchise purchase → mirror it into cashflow: an expense on the
      // outlet + matching income on HQ. No-op for an independent
      // transfer (purchaseTotal stays 0).
      if (purchaseTotal > 0) {
        await writeRequisitionCashflowEntries(tx, {
          tenantId: auth.tenantId,
          requisitionId: req.id,
          requisitionNumber: req.requisitionNumber,
          requestingBranchId: req.requestingBranchId,
          sourceBranchId: req.sourceBranchId,
          amount: purchaseTotal,
          occurredAt: now,
          createdByUserId: auth.userId,
        })
      }

      return header
    })

    await notifyRequester(req, auth.tenantId, 'fulfilled')
    return updated
  })

/**
 * Apply a signed delta to an (item, branch) stock balance, creating the
 * row if absent. Mirrors the upsert in `receivePurchaseOrder`. Negative
 * balances are allowed — consistent with the rest of the inventory
 * ledger (the fulfiller controls how much they send).
 */
async function upsertBalance(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  itemId: string,
  branchId: string,
  delta: number,
  now: Date,
) {
  const [existing] = await tx
    .select()
    .from(inventoryStockBalances)
    .where(
      and(
        eq(inventoryStockBalances.itemId, itemId),
        eq(inventoryStockBalances.branchId, branchId),
      ),
    )
    .limit(1)
  if (existing) {
    await tx
      .update(inventoryStockBalances)
      .set({
        quantity: (Number(existing.quantity) + delta).toString(),
        lastMovementAt: now,
        updatedAt: now,
      })
      .where(eq(inventoryStockBalances.id, existing.id))
  } else {
    await tx.insert(inventoryStockBalances).values({
      tenantId,
      itemId,
      branchId,
      quantity: delta.toString(),
      lastMovementAt: now,
    })
  }
}

// ─── Form data ───────────────────────────────────────────────────────

/**
 * Items + their per-item unit list, for the Buat Permintaan Stok form.
 * Mirrors `listItemsForPO` (same data shape) but:
 *   - feature-gated on `assertRequisitionFeatureAvailable` so a Free
 *     tenant still gets the upgrade error rather than a silent empty
 *     list, and
 *   - excludes recipe-backed POS products (`linked_hpp_product_id IS
 *     NOT NULL`). Those carry no own stock — sales deduct ingredients
 *     instead — so shipping them between branches is meaningless. The
 *     filter also dedupes the picker for tenants that ran the HPP →
 *     inventory material import (every recipe product had a sellable
 *     "POS" twin that shared its name with the raw-material row, e.g.
 *     "Green Tea" the cup vs "Green Tea" the leaves).
 *
 * Also returns `categoryName` and `baseUnitLabel` so the picker can
 * render a disambiguating sublabel for legitimately same-named items.
 */
export const listItemsForRequisition = createServerFn().handler(async () => {
  const auth = await requireInventoryAccess()
  assertRequisitionFeatureAvailable(auth.inventoryTier)

  const items = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      categoryName: tenantCategories.name,
      baseUnitLabel: masterHppUnits.label,
    })
    .from(inventoryItems)
    .leftJoin(
      tenantCategories,
      eq(tenantCategories.id, inventoryItems.categoryId),
    )
    .innerJoin(
      masterHppUnits,
      eq(masterHppUnits.id, inventoryItems.baseUnitId),
    )
    .where(
      and(
        eq(inventoryItems.tenantId, auth.tenantId),
        eq(inventoryItems.isActive, true),
        // Recipe-backed POS products have no own stock to move.
        isNull(inventoryItems.linkedHppProductId),
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
    categoryName: i.categoryName,
    baseUnitLabel: i.baseUnitLabel,
    units: unitsByItem.get(i.id) ?? [],
  }))
})
