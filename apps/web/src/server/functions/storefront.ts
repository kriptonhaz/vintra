/**
 * Toko Online — public (no-auth) storefront server functions.
 *
 *   - getStorefront(slug)         catalog + config for the shop section
 *   - validateStorefrontPromo     apply a code promo against a subtotal
 *   - placeOrder                  create a pending online order
 *
 * Everything is keyed by the tenant's public slug and gated by the
 * `tenant_site` feature (same as the Situs). Stock is NOT deducted here
 * — placement creates a `pending` order; deduction happens on admin
 * confirmation (Phase 4). Payment is manual recon via WhatsApp.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  tenants,
  branches,
  storefrontSettings,
  storefrontShippingZones,
  inventoryItems,
  inventoryItemUnitPricing,
  inventoryStockBalances,
  tenantCategories,
  posSettings,
  customers,
  tenantPromotions,
  onlineOrders,
  onlineOrderItems,
  onlineOrderCounters,
} from '@vintra/db/schema'
import { eq, and, inArray, asc, sql, isNull, or, lte, gte } from 'drizzle-orm'
import { getInventoryPhotoSignedUrl } from '@/lib/s3-storage'
import { getTenantSiteAccessForTenantId } from '../middleware/module-access'
import { computePromoAmount } from './promotions'

// ─── Helpers ───────────────────────────────────────────────────────

function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = input.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0')) digits = '62' + digits.slice(1)
  else if (digits.startsWith('8')) digits = '62' + digits
  return digits
}

type ResolvedTenant = {
  id: string
  businessName: string
  publicSlug: string | null
}

/** Resolve a tenant by slug + assert the `tenant_site` feature. */
async function resolveTenant(slug: string): Promise<ResolvedTenant | null> {
  if (!slug || slug.length > 60) return null
  const [tenant] = await db
    .select({
      id: tenants.id,
      businessName: tenants.businessName,
      publicSlug: tenants.publicSlug,
    })
    .from(tenants)
    .where(eq(tenants.publicSlug, slug))
    .limit(1)
  if (!tenant) return null
  const access = await getTenantSiteAccessForTenantId(tenant.id)
  if (!access?.hasTenantSite) return null
  return tenant
}

/** Fulfillment branch: configured one, else the oldest active branch. */
async function resolveFulfillmentBranchId(
  tenantId: string,
  configured: string | null,
): Promise<string | null> {
  if (configured) return configured
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt))
    .limit(1)
  return b?.id ?? null
}

/** Map of itemId → cheapest (first-tier) unit price string. */
async function firstTierPrices(itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (itemIds.length === 0) return out
  const rows = await db
    .select({
      itemId: inventoryItemUnitPricing.itemId,
      unitPrice: inventoryItemUnitPricing.unitPrice,
    })
    .from(inventoryItemUnitPricing)
    .where(inArray(inventoryItemUnitPricing.itemId, itemIds))
    .orderBy(
      asc(inventoryItemUnitPricing.minQty),
      asc(inventoryItemUnitPricing.sortOrder),
    )
  for (const r of rows) if (!out.has(r.itemId)) out.set(r.itemId, r.unitPrice)
  return out
}

/** Available online qty per item at a branch (balance capped by onlineStockCap). */
async function availableByItem(
  branchId: string,
  items: Array<{ id: string; onlineStockCap: string | null }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = items.map((i) => i.id)
  if (ids.length === 0) return out
  const balances = await db
    .select({
      itemId: inventoryStockBalances.itemId,
      quantity: inventoryStockBalances.quantity,
    })
    .from(inventoryStockBalances)
    .where(
      and(
        eq(inventoryStockBalances.branchId, branchId),
        inArray(inventoryStockBalances.itemId, ids),
      ),
    )
  const balById = new Map(balances.map((b) => [b.itemId, Number(b.quantity)]))
  for (const it of items) {
    const bal = balById.get(it.id) ?? 0
    const cap = it.onlineStockCap != null ? Number(it.onlineStockCap) : null
    out.set(it.id, cap != null ? Math.min(bal, cap) : bal)
  }
  return out
}

/**
 * Best-effort admin notification via the Go API's internal endpoint
 * (authed with INTERNAL_SERVICE_TOKEN). Swallows every error — the
 * storefront's wa.me deep link is the guaranteed fallback. Stamps
 * `wa_notified_at` on success. No-op when the token / API URL is unset.
 */
async function notifyAdminOfOrder(params: {
  tenantId: string
  instanceId: string
  orderId: string
  body: string
}): Promise<void> {
  const apiBase = process.env.API_URL
  const token = process.env.INTERNAL_SERVICE_TOKEN
  if (!apiBase || !token) return
  try {
    const res = await fetch(`${apiBase}/v1/internal/wa/notify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantId: params.tenantId,
        instanceId: params.instanceId,
        body: params.body,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      await db
        .update(onlineOrders)
        .set({ waNotifiedAt: new Date() })
        .where(eq(onlineOrders.id, params.orderId))
    }
  } catch {
    // Never let a notification failure affect order placement.
  }
}

// ─── getStorefront ─────────────────────────────────────────────────

export const getStorefront = createServerFn()
  .inputValidator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const tenant = await resolveTenant(data.slug)
    if (!tenant) return null

    const [settings] = await db
      .select()
      .from(storefrontSettings)
      .where(eq(storefrontSettings.tenantId, tenant.id))
      .limit(1)

    const [pos] = await db
      .select({
        defaultPaymentMethods: posSettings.defaultPaymentMethods,
        bankAccounts: posSettings.bankAccounts,
        taxes: posSettings.taxes,
      })
      .from(posSettings)
      .where(eq(posSettings.tenantId, tenant.id))
      .limit(1)

    const branchId = await resolveFulfillmentBranchId(
      tenant.id,
      settings?.fulfillmentBranchId ?? null,
    )

    // Catalog: explicitly online-curated items, with their category
    // name (for the storefront's category filter).
    const itemRows = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        photoKey: inventoryItems.photoKey,
        onlineStockCap: inventoryItems.onlineStockCap,
        shippingWeightGrams: inventoryItems.shippingWeightGrams,
        category: tenantCategories.name,
      })
      .from(inventoryItems)
      .leftJoin(
        tenantCategories,
        eq(inventoryItems.categoryId, tenantCategories.id),
      )
      .where(
        and(
          eq(inventoryItems.tenantId, tenant.id),
          eq(inventoryItems.isOnline, true),
          eq(inventoryItems.isActive, true),
        ),
      )
      .orderBy(asc(inventoryItems.name))

    const priceByItem = await firstTierPrices(itemRows.map((r) => r.id))
    const availByItem = branchId
      ? await availableByItem(branchId, itemRows)
      : new Map<string, number>()

    const photoByItem = new Map<string, string>()
    await Promise.all(
      itemRows
        .filter((r): r is typeof r & { photoKey: string } => !!r.photoKey)
        .map(async (r) => {
          try {
            photoByItem.set(
              r.id,
              await getInventoryPhotoSignedUrl(r.photoKey, 7 * 24 * 3600),
            )
          } catch {
            // photo gone — omit
          }
        }),
    )

    const products = itemRows.map((r) => ({
      id: r.id,
      name: r.name,
      unitPrice: priceByItem.get(r.id) ?? '0',
      imageUrl: photoByItem.get(r.id) ?? null,
      available: branchId ? (availByItem.get(r.id) ?? 0) : null,
      weightGrams: r.shippingWeightGrams,
      category: r.category,
    }))

    // Payment subset, re-intersected with what POS currently allows.
    const posMethods = new Set(pos?.defaultPaymentMethods ?? [])
    const methods = (settings?.paymentMethods ?? []).filter((m) =>
      posMethods.has(m),
    )
    const bankAccounts = (pos?.bankAccounts ?? []).filter((b) => b.active)
    const taxes = (pos?.taxes ?? []).filter((t) => t.active)

    const zones = await db
      .select({
        id: storefrontShippingZones.id,
        name: storefrontShippingZones.name,
        fee: storefrontShippingZones.fee,
      })
      .from(storefrontShippingZones)
      .where(
        and(
          eq(storefrontShippingZones.tenantId, tenant.id),
          eq(storefrontShippingZones.isActive, true),
        ),
      )
      .orderBy(asc(storefrontShippingZones.sortOrder))

    return {
      enabled: settings?.isEnabled ?? false,
      businessName: tenant.businessName,
      products,
      payment: {
        methods,
        bankAccounts: bankAccounts.map((b) => ({
          bankName: b.bankName,
          accountNumber: b.accountNumber,
          accountHolder: b.accountHolder,
        })),
      },
      tax: {
        apply: settings?.applyTax ?? true,
        lines: taxes.map((t) => ({ label: t.label, percent: t.percent })),
      },
      shipping: {
        deliveryEnabled: settings?.deliveryEnabled ?? true,
        pickupEnabled: settings?.pickupEnabled ?? true,
        flatFee: Number(settings?.flatShippingFee ?? 0),
        zones: zones.map((z) => ({
          id: z.id,
          name: z.name,
          fee: Number(z.fee),
        })),
      },
      waConfirmPhone: settings?.waConfirmPhone ?? null,
      checkoutNote: settings?.checkoutNote ?? null,
    }
  })

// ─── validateStorefrontPromo ───────────────────────────────────────

export const validateStorefrontPromo = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string(),
      code: z.string().min(1).max(50),
      subtotal: z.coerce.number().min(0),
    }),
  )
  .handler(async ({ data }) => {
    const tenant = await resolveTenant(data.slug)
    if (!tenant) return { valid: false as const, message: 'Toko tidak ditemukan' }

    const promo = await findActiveCodePromo(tenant.id, data.code)
    if (!promo) return { valid: false as const, message: 'Kode promo tidak valid' }
    if (
      promo.minCartTotal != null &&
      data.subtotal < Number(promo.minCartTotal)
    ) {
      return {
        valid: false as const,
        message: `Minimal belanja Rp ${Number(promo.minCartTotal).toLocaleString('id-ID')}`,
      }
    }
    const amount = computePromoAmount(promo, data.subtotal)
    if (amount <= 0)
      return { valid: false as const, message: 'Promo tidak berlaku' }
    return {
      valid: true as const,
      code: promo.code as string,
      amount,
      name: promo.name,
    }
  })

/** Look up an active code-mode promo within its date window. */
async function findActiveCodePromo(tenantId: string, code: string) {
  const now = new Date()
  const [promo] = await db
    .select()
    .from(tenantPromotions)
    .where(
      and(
        eq(tenantPromotions.tenantId, tenantId),
        eq(tenantPromotions.triggerType, 'code'),
        eq(tenantPromotions.isActive, true),
        sql`lower(${tenantPromotions.code}) = lower(${code})`,
        or(isNull(tenantPromotions.startsAt), lte(tenantPromotions.startsAt, now)),
        or(isNull(tenantPromotions.endsAt), gte(tenantPromotions.endsAt, now)),
      ),
    )
    .limit(1)
  return promo ?? null
}

// ─── trackOrder ────────────────────────────────────────────────────

export const trackOrder = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string(),
      orderNumber: z.string().min(1).max(40),
      phone: z.string().min(4).max(25),
    }),
  )
  .handler(async ({ data }) => {
    const tenant = await resolveTenant(data.slug)
    if (!tenant) return { found: false as const }
    const phone = normalizePhone(data.phone)
    if (!phone) return { found: false as const }

    const [order] = await db
      .select({
        orderNumber: onlineOrders.orderNumber,
        status: onlineOrders.status,
        fulfillmentType: onlineOrders.fulfillmentType,
        total: onlineOrders.total,
        paymentMethod: onlineOrders.paymentMethod,
        courierName: onlineOrders.courierName,
        trackingNumber: onlineOrders.trackingNumber,
        createdAt: onlineOrders.createdAt,
        cancelReason: onlineOrders.cancelReason,
      })
      .from(onlineOrders)
      .where(
        and(
          eq(onlineOrders.tenantId, tenant.id),
          sql`upper(${onlineOrders.orderNumber}) = upper(${data.orderNumber.trim()})`,
          eq(onlineOrders.customerPhone, phone),
        ),
      )
      .limit(1)
    if (!order) return { found: false as const }

    const items = await db
      .select({
        nameSnapshot: onlineOrderItems.nameSnapshot,
        qty: onlineOrderItems.qty,
        subtotal: onlineOrderItems.subtotal,
      })
      .from(onlineOrderItems)
      .innerJoin(onlineOrders, eq(onlineOrders.id, onlineOrderItems.orderId))
      .where(
        and(
          eq(onlineOrders.tenantId, tenant.id),
          eq(onlineOrders.orderNumber, order.orderNumber),
        ),
      )

    return {
      found: true as const,
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      total: Number(order.total),
      paymentMethod: order.paymentMethod,
      courierName: order.courierName,
      trackingNumber: order.trackingNumber,
      cancelReason: order.cancelReason,
      items: items.map((i) => ({
        name: i.nameSnapshot,
        qty: Number(i.qty),
        subtotal: Number(i.subtotal),
      })),
    }
  })

/** Atomic per-tenant order number: ORD-YYYY-00001. Mirrors nextSaleNumber. */
async function nextOrderNumber(
  tx: typeof db,
  tenantId: string,
  now: Date,
): Promise<string> {
  const year = now.getUTCFullYear()
  const [row] = await tx.execute<{ used_seq: number }>(sql`
    INSERT INTO online_order_counters (tenant_id, year, next_seq)
    VALUES (${tenantId}, ${year}, 2)
    ON CONFLICT (tenant_id) DO UPDATE
      SET year = ${year},
          next_seq = CASE
            WHEN online_order_counters.year = ${year}
              THEN online_order_counters.next_seq + 1
            ELSE 2
          END
    RETURNING (online_order_counters.next_seq - 1) AS used_seq
  `)
  const useSeq = Number(row?.used_seq ?? 1)
  return `ORD-${year}-${String(useSeq).padStart(5, '0')}`
}

// ─── placeOrder ────────────────────────────────────────────────────

const placeOrderInput = z.object({
  slug: z.string(),
  fulfillmentType: z.enum(['delivery', 'pickup']),
  customerName: z.string().min(1, 'Nama wajib diisi').max(120),
  customerPhone: z.string().min(6, 'Nomor WhatsApp wajib diisi').max(25),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        qty: z.coerce.number().int().min(1),
      }),
    )
    .min(1, 'Keranjang kosong'),
  shippingRecipient: z.string().max(120).optional().nullable(),
  shippingPhone: z.string().max(25).optional().nullable(),
  shippingAddress: z.string().max(500).optional().nullable(),
  shippingZoneId: z.string().uuid().optional().nullable(),
  promoCode: z.string().max(50).optional().nullable(),
  paymentMethod: z.string().min(1),
  customerNote: z.string().max(500).optional().nullable(),
})

export const placeOrder = createServerFn({ method: 'POST' })
  .inputValidator(placeOrderInput)
  .handler(async ({ data }) => {
    const tenant = await resolveTenant(data.slug)
    if (!tenant) throw new Error('Toko tidak ditemukan')

    const [settings] = await db
      .select()
      .from(storefrontSettings)
      .where(eq(storefrontSettings.tenantId, tenant.id))
      .limit(1)
    if (!settings?.isEnabled) throw new Error('Toko sedang tidak aktif')

    // Fulfillment + payment validity.
    if (data.fulfillmentType === 'delivery' && !settings.deliveryEnabled)
      throw new Error('Pengiriman tidak tersedia')
    if (data.fulfillmentType === 'pickup' && !settings.pickupEnabled)
      throw new Error('Ambil di tempat tidak tersedia')

    const [pos] = await db
      .select({
        defaultPaymentMethods: posSettings.defaultPaymentMethods,
        bankAccounts: posSettings.bankAccounts,
        taxes: posSettings.taxes,
      })
      .from(posSettings)
      .where(eq(posSettings.tenantId, tenant.id))
      .limit(1)
    const posMethods = new Set(pos?.defaultPaymentMethods ?? [])
    const allowedMethods = (settings.paymentMethods ?? []).filter((m) =>
      posMethods.has(m),
    )
    if (!allowedMethods.includes(data.paymentMethod))
      throw new Error('Metode pembayaran tidak tersedia')

    const branchId = await resolveFulfillmentBranchId(
      tenant.id,
      settings.fulfillmentBranchId,
    )
    if (!branchId) throw new Error('Cabang pemenuhan belum diatur')

    // Re-load + re-price items authoritatively.
    const itemIds = data.items.map((i) => i.itemId)
    const rows = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        costPrice: inventoryItems.costPrice,
        onlineStockCap: inventoryItems.onlineStockCap,
        shippingWeightGrams: inventoryItems.shippingWeightGrams,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, tenant.id),
          inArray(inventoryItems.id, itemIds),
          eq(inventoryItems.isOnline, true),
          eq(inventoryItems.isActive, true),
        ),
      )
    const byId = new Map(rows.map((r) => [r.id, r]))
    const priceByItem = await firstTierPrices(rows.map((r) => r.id))
    const availByItem = await availableByItem(branchId, rows)

    let subtotal = 0
    const lineItems = data.items.map((line) => {
      const item = byId.get(line.itemId)
      if (!item) throw new Error('Produk tidak tersedia lagi')
      const avail = availByItem.get(item.id) ?? 0
      if (avail < line.qty)
        throw new Error(`Stok "${item.name}" tidak cukup (sisa ${avail})`)
      const unitPrice = Number(priceByItem.get(item.id) ?? '0')
      const lineSubtotal = unitPrice * line.qty
      subtotal += lineSubtotal
      return {
        itemId: item.id,
        nameSnapshot: item.name,
        skuSnapshot: item.sku,
        qty: line.qty,
        unitPrice,
        subtotal: lineSubtotal,
        weightGramsSnapshot: item.shippingWeightGrams,
        hppAtSale: Number(item.costPrice),
      }
    })

    // Promo (code-mode only at checkout).
    let promoCodeSnapshot: string | null = null
    let promoAmount = 0
    if (data.promoCode?.trim()) {
      const promo = await findActiveCodePromo(tenant.id, data.promoCode.trim())
      if (promo && (promo.minCartTotal == null || subtotal >= Number(promo.minCartTotal))) {
        promoAmount = computePromoAmount(promo, subtotal)
        if (promoAmount > 0) promoCodeSnapshot = promo.code
      }
    }

    // Tax — mirror POS active taxes on the post-promo base.
    const taxBase = Math.max(0, subtotal - promoAmount)
    const taxLines: Array<{ label: string; percent: number; amount: number }> = []
    let taxAmount = 0
    if (settings.applyTax) {
      for (const t of (pos?.taxes ?? []).filter((x) => x.active)) {
        const amt = Math.round((taxBase * Number(t.percent)) / 100)
        if (amt > 0) {
          taxLines.push({ label: t.label, percent: Number(t.percent), amount: amt })
          taxAmount += amt
        }
      }
    }

    // Shipping.
    let shippingFee = 0
    let shippingZoneLabel: string | null = null
    let shippingZoneId: string | null = null
    if (data.fulfillmentType === 'delivery') {
      if (!data.shippingAddress?.trim())
        throw new Error('Alamat pengiriman wajib diisi')
      if (data.shippingZoneId) {
        const [zone] = await db
          .select()
          .from(storefrontShippingZones)
          .where(
            and(
              eq(storefrontShippingZones.id, data.shippingZoneId),
              eq(storefrontShippingZones.tenantId, tenant.id),
              eq(storefrontShippingZones.isActive, true),
            ),
          )
          .limit(1)
        if (zone) {
          shippingFee = Number(zone.fee)
          shippingZoneLabel = zone.name
          shippingZoneId = zone.id
        } else {
          shippingFee = Number(settings.flatShippingFee)
        }
      } else {
        shippingFee = Number(settings.flatShippingFee)
      }
    }

    const total = Math.max(0, subtotal - promoAmount) + taxAmount + shippingFee

    const phone = normalizePhone(data.customerPhone)
    const now = new Date()

    // Customer upsert by normalised phone (CRM linkage; best-effort).
    let customerId: string | null = null
    if (phone) {
      const [existing] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.tenantId, tenant.id), eq(customers.phone, phone)))
        .limit(1)
      if (existing) customerId = existing.id
      else {
        const [created] = await db
          .insert(customers)
          .values({ tenantId: tenant.id, name: data.customerName, phone })
          .returning({ id: customers.id })
        customerId = created?.id ?? null
      }
    }

    const { orderNumber, orderId } = await db.transaction(async (tx) => {
      const num = await nextOrderNumber(tx as unknown as typeof db, tenant.id, now)
      const [order] = await tx
        .insert(onlineOrders)
        .values({
          tenantId: tenant.id,
          branchId,
          orderNumber: num,
          customerId,
          customerName: data.customerName,
          customerPhone: phone ?? data.customerPhone,
          fulfillmentType: data.fulfillmentType,
          shippingRecipient:
            data.fulfillmentType === 'delivery'
              ? data.shippingRecipient ?? data.customerName
              : null,
          shippingPhone:
            data.fulfillmentType === 'delivery'
              ? normalizePhone(data.shippingPhone) ?? phone
              : null,
          shippingAddress:
            data.fulfillmentType === 'delivery' ? data.shippingAddress : null,
          shippingZoneId,
          shippingZoneLabel,
          shippingFee: shippingFee.toString(),
          subtotal: subtotal.toString(),
          promoCodeSnapshot,
          promoAmount: promoAmount.toString(),
          taxAmount: taxAmount.toString(),
          taxLines: taxLines.length > 0 ? taxLines : null,
          total: total.toString(),
          paymentMethod: data.paymentMethod,
          status: 'pending',
          customerNote: data.customerNote?.trim() ? data.customerNote : null,
        })
        .returning({ id: onlineOrders.id })
      if (!order) throw new Error('Gagal membuat pesanan')

      await tx.insert(onlineOrderItems).values(
        lineItems.map((li) => ({
          tenantId: tenant.id,
          orderId: order.id,
          itemId: li.itemId,
          nameSnapshot: li.nameSnapshot,
          skuSnapshot: li.skuSnapshot,
          qty: li.qty.toString(),
          unitPrice: li.unitPrice.toString(),
          subtotal: li.subtotal.toString(),
          weightGramsSnapshot: li.weightGramsSnapshot,
          hppAtSale: li.hppAtSale.toString(),
        })),
      )
      return { orderNumber: num, orderId: order.id }
    })

    // Payment instructions snapshot for the confirmation screen.
    const bankAccounts =
      data.paymentMethod === 'transfer'
        ? (pos?.bankAccounts ?? [])
            .filter((b) => b.active)
            .map((b) => ({
              bankName: b.bankName,
              accountNumber: b.accountNumber,
              accountHolder: b.accountHolder,
            }))
        : []

    // wa.me deep link (no integration needed).
    let waLink: string | null = null
    if (settings.waConfirmPhone) {
      const msg =
        `Halo ${tenant.businessName}, saya mau konfirmasi pesanan ${orderNumber}. ` +
        `Total Rp ${total.toLocaleString('id-ID')} via ${data.paymentMethod}. ` +
        `Atas nama ${data.customerName}.`
      waLink = `https://wa.me/${settings.waConfirmPhone}?text=${encodeURIComponent(msg)}`
    }

    // Integrated path (best-effort): auto-notify the admin via the
    // tenant's connected WhatsApp. Never blocks/fails the order — the
    // wa.me deep link above is the guaranteed fallback.
    if (settings.adminNotifyInstanceId) {
      void notifyAdminOfOrder({
        tenantId: tenant.id,
        instanceId: settings.adminNotifyInstanceId,
        orderId,
        body:
          `🛍️ *Pesanan baru ${orderNumber}*\n` +
          `${data.customerName} (${phone ?? data.customerPhone})\n` +
          `${lineItems.length} item • Total Rp ${total.toLocaleString('id-ID')}\n` +
          `Bayar: ${data.paymentMethod} • ${data.fulfillmentType === 'pickup' ? 'Ambil di tempat' : 'Dikirim'}\n` +
          `Buka Vintra untuk konfirmasi.`,
      })
    }

    return {
      orderNumber,
      total,
      paymentMethod: data.paymentMethod,
      bankAccounts,
      waLink,
      checkoutNote: settings.checkoutNote ?? null,
    }
  })
