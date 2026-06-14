/**
 * Toko Online — admin order management (Phase 4).
 *
 * Gated by `requireTenantSiteAccess` (Komplit + tenant_site) + the
 * `pos.manage` permission. Drives the order lifecycle:
 *
 *   pending ──confirm──▶ confirmed ──fulfill──▶ shipped|ready ──▶ completed
 *      └────────────────── cancel ──────────────────┘ (restock if deducted)
 *
 * Stock is deducted on CONFIRM (manual payment recon) and added back on
 * cancel if the order had already been confirmed. Mirrors the POS sale
 * deduction (inline movement + balance upsert, base units), skipping
 * recipe-backed items just like the cashier path.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  onlineOrders,
  onlineOrderItems,
  inventoryItems,
  inventoryMovements,
  inventoryStockBalances,
} from '@vintra/db/schema'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import {
  requireTenantSiteAccess,
  type POSAccessContext,
} from '../middleware/module-access'

function assertManage(auth: POSAccessContext) {
  if (!auth.permissions.includes('pos.manage')) throw new Error('Forbidden')
}

// ─── Read ──────────────────────────────────────────────────────────

export const listOnlineOrders = createServerFn({ method: 'POST' })
  .inputValidator(
    z
      .object({
        status: z
          .enum(['pending', 'confirmed', 'ready', 'shipped', 'completed', 'cancelled'])
          .optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)

    const where = data?.status
      ? and(
          eq(onlineOrders.tenantId, auth.tenantId),
          eq(onlineOrders.status, data.status),
        )
      : eq(onlineOrders.tenantId, auth.tenantId)

    const orders = await db
      .select({
        id: onlineOrders.id,
        orderNumber: onlineOrders.orderNumber,
        customerName: onlineOrders.customerName,
        customerPhone: onlineOrders.customerPhone,
        fulfillmentType: onlineOrders.fulfillmentType,
        total: onlineOrders.total,
        paymentMethod: onlineOrders.paymentMethod,
        status: onlineOrders.status,
        createdAt: onlineOrders.createdAt,
      })
      .from(onlineOrders)
      .where(where)
      .orderBy(desc(onlineOrders.createdAt))
      .limit(200)

    // Item counts per order in one grouped query.
    const ids = orders.map((o) => o.id)
    const counts = new Map<string, number>()
    if (ids.length > 0) {
      const rows = await db
        .select({
          orderId: onlineOrderItems.orderId,
          n: sql<number>`count(*)::int`,
        })
        .from(onlineOrderItems)
        .where(inArray(onlineOrderItems.orderId, ids))
        .groupBy(onlineOrderItems.orderId)
      for (const r of rows) counts.set(r.orderId, Number(r.n))
    }

    return orders.map((o) => ({ ...o, itemCount: counts.get(o.id) ?? 0 }))
  })

export const getOnlineOrder = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)

    const [order] = await db
      .select()
      .from(onlineOrders)
      .where(
        and(
          eq(onlineOrders.id, data.id),
          eq(onlineOrders.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!order) throw new Error('Pesanan tidak ditemukan')

    const items = await db
      .select()
      .from(onlineOrderItems)
      .where(eq(onlineOrderItems.orderId, order.id))

    return { order, items }
  })

// ─── Stock helpers ─────────────────────────────────────────────────

/**
 * Apply (or reverse) stock for an order's line items at its branch.
 * `direction` 'out' deducts (confirm), 'in' restocks (cancel). Skips
 * recipe-backed items, matching the POS sale path.
 */
async function moveOrderStock(
  tx: typeof db,
  params: {
    tenantId: string
    branchId: string
    orderId: string
    orderNumber: string
    userId: string
    direction: 'out' | 'in'
  },
) {
  const lines = await tx
    .select({
      itemId: onlineOrderItems.itemId,
      qty: onlineOrderItems.qty,
      hppAtSale: onlineOrderItems.hppAtSale,
      linkedHppProductId: inventoryItems.linkedHppProductId,
    })
    .from(onlineOrderItems)
    .leftJoin(inventoryItems, eq(inventoryItems.id, onlineOrderItems.itemId))
    .where(eq(onlineOrderItems.orderId, params.orderId))

  const now = new Date()
  for (const line of lines) {
    if (!line.itemId) continue
    // Recipe-backed items aren't stock-tracked at item level (POS parity).
    if (line.linkedHppProductId) continue
    const qty = Number(line.qty)
    if (qty <= 0) continue
    const signed = params.direction === 'out' ? -qty : qty

    await tx.insert(inventoryMovements).values({
      tenantId: params.tenantId,
      itemId: line.itemId,
      branchId: params.branchId,
      movementType: params.direction,
      quantity: qty.toString(),
      unitCost: line.hppAtSale != null ? line.hppAtSale.toString() : null,
      reason: 'online_order',
      referenceType: 'online_order',
      referenceId: params.orderId,
      notes:
        params.direction === 'out'
          ? `Pesanan online ${params.orderNumber}`
          : `Pembatalan pesanan ${params.orderNumber}`,
      performedBy: params.userId,
    })

    const [existing] = await tx
      .select({
        id: inventoryStockBalances.id,
        quantity: inventoryStockBalances.quantity,
      })
      .from(inventoryStockBalances)
      .where(
        and(
          eq(inventoryStockBalances.itemId, line.itemId),
          eq(inventoryStockBalances.branchId, params.branchId),
        ),
      )
      .limit(1)
    if (existing) {
      await tx
        .update(inventoryStockBalances)
        .set({
          quantity: (Number(existing.quantity) + signed).toString(),
          lastMovementAt: now,
          updatedAt: now,
        })
        .where(eq(inventoryStockBalances.id, existing.id))
    } else {
      await tx.insert(inventoryStockBalances).values({
        tenantId: params.tenantId,
        itemId: line.itemId,
        branchId: params.branchId,
        quantity: signed.toString(),
        lastMovementAt: now,
      })
    }
  }
}

/** Load + tenant-scope an order, or throw. */
async function loadOrder(tenantId: string, id: string) {
  const [order] = await db
    .select()
    .from(onlineOrders)
    .where(and(eq(onlineOrders.id, id), eq(onlineOrders.tenantId, tenantId)))
    .limit(1)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  return order
}

// ─── Transitions ───────────────────────────────────────────────────

export const confirmOnlineOrder = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)
    const order = await loadOrder(auth.tenantId, data.id)
    if (order.status !== 'pending')
      throw new Error('Pesanan sudah diproses')

    const now = new Date()
    await db.transaction(async (tx) => {
      await moveOrderStock(tx as unknown as typeof db, {
        tenantId: auth.tenantId,
        branchId: order.branchId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: auth.userId,
        direction: 'out',
      })
      await tx
        .update(onlineOrders)
        .set({ status: 'confirmed', confirmedAt: now, confirmedBy: auth.userId, updatedAt: now })
        .where(eq(onlineOrders.id, order.id))
    })
    return { success: true as const }
  })

export const fulfillOnlineOrder = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      courierName: z.string().max(80).optional().nullable(),
      trackingNumber: z.string().max(80).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)
    const order = await loadOrder(auth.tenantId, data.id)
    if (order.status !== 'confirmed')
      throw new Error('Pesanan harus dikonfirmasi dulu')

    const now = new Date()
    // Delivery → shipped (with resi); pickup → ready for collection.
    const nextStatus = order.fulfillmentType === 'pickup' ? 'ready' : 'shipped'
    await db
      .update(onlineOrders)
      .set({
        status: nextStatus,
        courierName: data.courierName?.trim() || null,
        trackingNumber: data.trackingNumber?.trim() || null,
        shippedAt: now,
        updatedAt: now,
      })
      .where(eq(onlineOrders.id, order.id))
    return { success: true as const, status: nextStatus }
  })

export const completeOnlineOrder = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)
    const order = await loadOrder(auth.tenantId, data.id)
    if (!['confirmed', 'ready', 'shipped'].includes(order.status))
      throw new Error('Pesanan belum bisa diselesaikan')
    const now = new Date()
    await db
      .update(onlineOrders)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(onlineOrders.id, order.id))
    return { success: true as const }
  })

export const cancelOnlineOrder = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ id: z.string().uuid(), reason: z.string().max(300).optional() }),
  )
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)
    const order = await loadOrder(auth.tenantId, data.id)
    if (order.status === 'completed' || order.status === 'cancelled')
      throw new Error('Pesanan sudah final')

    // Restock only if stock was already deducted (post-confirmation).
    const wasDeducted = ['confirmed', 'ready', 'shipped'].includes(order.status)
    const now = new Date()
    await db.transaction(async (tx) => {
      if (wasDeducted) {
        await moveOrderStock(tx as unknown as typeof db, {
          tenantId: auth.tenantId,
          branchId: order.branchId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: auth.userId,
          direction: 'in',
        })
      }
      await tx
        .update(onlineOrders)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: auth.userId,
          cancelReason: data.reason?.trim() || null,
          updatedAt: now,
        })
        .where(eq(onlineOrders.id, order.id))
    })
    return { success: true as const }
  })
