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
  tenantSites,
  branches,
  storefrontSettings,
  storefrontShippingZones,
  inventoryItems,
  inventoryItemUnitPricing,
  inventoryItemPhotos,
  inventoryStockBalances,
  inventoryItemVariants,
  inventoryItemVariantStock,
  tenantCategories,
  posSettings,
  customers,
  tenantPromotions,
  onlineOrders,
  onlineOrderItems,
  onlineOrderCounters,
  onlineProductReviews,
} from '@vintra/db/schema'
import {
  eq,
  and,
  inArray,
  asc,
  desc,
  sql,
  isNull,
  or,
  lte,
  gte,
} from 'drizzle-orm'
import { getRequest } from '@tanstack/react-start/server'
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

/**
 * Masks a reviewer's name for public display: first word kept, the rest
 * reduced to an initial + "***" (e.g. "Budi Santoso" → "Budi S***",
 * "Budi" → "Budi"). Keeps reviews feeling personal without exposing the
 * full identity of a buyer.
 */
function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return 'Pembeli'
  const second = parts[1]
  if (!second) return first
  return `${first} ${second[0]!.toUpperCase()}***`
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

/**
 * Extract a tenant slug from the request Host header (`<slug>.vintra.my.id`).
 * Returns null on the apex / www / api / dev (localhost) — the storefront
 * page routes treat that as "no storefront here" and redirect to `/`.
 * Mirrors the host parsing in getIndexRouteHostData.
 */
function slugFromHost(): string | null {
  let host: string | null = null
  try {
    host = getRequest().headers.get('host')
  } catch {
    host = null
  }
  if (!host) return null
  const hostname = host.split(':')[0]!.toLowerCase()
  const m = hostname.match(/^([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\.vintra\.my\.id$/)
  if (!m) return null
  const slug = m[1]!
  if (slug === 'www' || slug === 'api') return null
  return slug
}

/** The tenant's published brand color (for theming storefront pages). */
async function brandColorFor(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ published: tenantSites.publishedSettings })
    .from(tenantSites)
    .where(eq(tenantSites.tenantId, tenantId))
    .limit(1)
  const theme = (row?.published as { theme?: { brandColor?: unknown } } | null)
    ?.theme
  const c = theme?.brandColor
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#2563EB'
}

/**
 * Shared context for every storefront sub-page (/cart, /checkout, /track).
 * Resolves the tenant from the Host header; returns null on the apex so
 * the route can redirect home.
 */
export const getStorefrontContext = createServerFn().handler(async () => {
  const slug = slugFromHost()
  if (!slug) return null
  const tenant = await resolveTenant(slug)
  if (!tenant) return null
  return {
    slug,
    businessName: tenant.businessName,
    brandColor: await brandColorFor(tenant.id),
  }
})

/**
 * Single product detail for the `/product/$id` page. Host-resolved.
 * Returns null on apex / disabled store / missing-or-offline item so the
 * route redirects or 404s.
 */
export const getStorefrontProduct = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const slug = slugFromHost()
    if (!slug) return null
    const tenant = await resolveTenant(slug)
    if (!tenant) return null

    const [settings] = await db
      .select()
      .from(storefrontSettings)
      .where(eq(storefrontSettings.tenantId, tenant.id))
      .limit(1)
    if (!settings?.isEnabled) return null

    const branchId = await resolveFulfillmentBranchId(
      tenant.id,
      settings.fulfillmentBranchId,
    )

    const [item] = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        notes: inventoryItems.notes,
        photoKey: inventoryItems.photoKey,
        onlineStockCap: inventoryItems.onlineStockCap,
        shippingWeightGrams: inventoryItems.shippingWeightGrams,
        hasVariants: inventoryItems.hasVariants,
        variantConfig: inventoryItems.variantConfig,
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
          eq(inventoryItems.id, data.id),
          eq(inventoryItems.isOnline, true),
          eq(inventoryItems.isActive, true),
        ),
      )
      .limit(1)
    if (!item) return null

    let unitPrice = '0'
    let available: number | null = null
    let variants: Array<{
      id: string
      value1: string
      value2: string
      label: string
      price: number
      available: number | null
    }> = []

    if (item.hasVariants) {
      const vRows = await db
        .select({
          id: inventoryItemVariants.id,
          value1: inventoryItemVariants.value1,
          value2: inventoryItemVariants.value2,
          price: inventoryItemVariants.price,
          sortOrder: inventoryItemVariants.sortOrder,
          stock: inventoryItemVariantStock.quantity,
        })
        .from(inventoryItemVariants)
        .leftJoin(
          inventoryItemVariantStock,
          and(
            eq(inventoryItemVariantStock.variantId, inventoryItemVariants.id),
            branchId
              ? eq(inventoryItemVariantStock.branchId, branchId)
              : sql`false`,
          ),
        )
        .where(
          and(
            eq(inventoryItemVariants.itemId, item.id),
            eq(inventoryItemVariants.isActive, true),
          ),
        )
        .orderBy(asc(inventoryItemVariants.sortOrder))
      variants = vRows.map((v) => ({
        id: v.id,
        value1: v.value1,
        value2: v.value2,
        label: v.value2 ? `${v.value1} / ${v.value2}` : v.value1,
        price: Number(v.price),
        available: branchId ? Number(v.stock ?? 0) : null,
      }))
      const prices = variants.map((v) => v.price).filter((p) => p > 0)
      unitPrice = prices.length > 0 ? String(Math.min(...prices)) : '0'
      available = branchId
        ? variants.reduce((n, v) => n + (v.available ?? 0), 0)
        : null
    } else {
      unitPrice = (await firstTierPrices([item.id])).get(item.id) ?? '0'
      available = branchId
        ? ((await availableByItem(branchId, [item])).get(item.id) ?? 0)
        : null
    }

    let imageUrl: string | null = null
    if (item.photoKey) {
      try {
        imageUrl = await getInventoryPhotoSignedUrl(item.photoKey, 7 * 24 * 3600)
      } catch {
        // photo gone — omit
      }
    }

    // Gallery: cover first (if any), then the extra photos in order.
    const galleryRows = await db
      .select({ photoKey: inventoryItemPhotos.photoKey })
      .from(inventoryItemPhotos)
      .where(eq(inventoryItemPhotos.itemId, item.id))
      .orderBy(
        asc(inventoryItemPhotos.sortOrder),
        asc(inventoryItemPhotos.createdAt),
      )
    const galleryUrls = (
      await Promise.all(
        galleryRows.map((r) =>
          getInventoryPhotoSignedUrl(r.photoKey, 7 * 24 * 3600).catch(
            () => null,
          ),
        ),
      )
    ).filter((u): u is string => !!u)
    const images = [...(imageUrl ? [imageUrl] : []), ...galleryUrls]

    // Visible reviews (newest first) + summary for this product — only
    // when the tenant has reviews turned on.
    const reviewRows = settings.reviewsEnabled
      ? await db
          .select({
            customerName: onlineProductReviews.customerName,
            rating: onlineProductReviews.rating,
            comment: onlineProductReviews.comment,
            createdAt: onlineProductReviews.createdAt,
          })
          .from(onlineProductReviews)
          .where(
            and(
              eq(onlineProductReviews.itemId, item.id),
              eq(onlineProductReviews.isHidden, false),
            ),
          )
          .orderBy(desc(onlineProductReviews.createdAt))
          .limit(50)
      : []
    const reviewCount = reviewRows.length
    const ratingAvg =
      reviewCount > 0
        ? reviewRows.reduce((s, r) => s + r.rating, 0) / reviewCount
        : 0

    return {
      slug,
      businessName: tenant.businessName,
      brandColor: await brandColorFor(tenant.id),
      product: {
        id: item.id,
        name: item.name,
        description: item.notes?.trim() || null,
        imageUrl,
        images,
        reviewsEnabled: settings.reviewsEnabled,
        ratingAvg,
        reviewCount,
        reviews: reviewRows.map((r) => ({
          customerName: maskName(r.customerName),
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt.toISOString(),
        })),
        unitPrice,
        available,
        weightGrams: item.shippingWeightGrams,
        category: item.category,
        hasVariants: item.hasVariants,
        variantConfig: item.hasVariants ? item.variantConfig : null,
        variants,
      },
    }
  })

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
        hasVariants: inventoryItems.hasVariants,
        variantConfig: inventoryItems.variantConfig,
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

    // Variants for the variant items, with available stock at the
    // fulfillment branch. Built into a per-item map.
    const variantItemIds = itemRows.filter((r) => r.hasVariants).map((r) => r.id)
    const variantsByItem = new Map<
      string,
      Array<{
        id: string
        value1: string
        value2: string
        label: string
        price: number
        available: number | null
      }>
    >()
    if (variantItemIds.length > 0) {
      const vRows = await db
        .select({
          id: inventoryItemVariants.id,
          itemId: inventoryItemVariants.itemId,
          value1: inventoryItemVariants.value1,
          value2: inventoryItemVariants.value2,
          price: inventoryItemVariants.price,
          sortOrder: inventoryItemVariants.sortOrder,
        })
        .from(inventoryItemVariants)
        .where(
          and(
            inArray(inventoryItemVariants.itemId, variantItemIds),
            eq(inventoryItemVariants.isActive, true),
          ),
        )
        .orderBy(asc(inventoryItemVariants.sortOrder))

      const vIds = vRows.map((v) => v.id)
      const stockByVariant = new Map<string, number>()
      if (branchId && vIds.length > 0) {
        const sRows = await db
          .select({
            variantId: inventoryItemVariantStock.variantId,
            quantity: inventoryItemVariantStock.quantity,
          })
          .from(inventoryItemVariantStock)
          .where(
            and(
              eq(inventoryItemVariantStock.branchId, branchId),
              inArray(inventoryItemVariantStock.variantId, vIds),
            ),
          )
        for (const s of sRows) stockByVariant.set(s.variantId, Number(s.quantity))
      }

      for (const v of vRows) {
        const list = variantsByItem.get(v.itemId) ?? []
        list.push({
          id: v.id,
          value1: v.value1,
          value2: v.value2,
          label: v.value2 ? `${v.value1} / ${v.value2}` : v.value1,
          price: Number(v.price),
          available: branchId ? (stockByVariant.get(v.id) ?? 0) : null,
        })
        variantsByItem.set(v.itemId, list)
      }
    }

    // Rating summary per item (visible reviews only) for the cards —
    // skipped entirely when the tenant turned reviews off.
    const ratingByItem = new Map<string, { avg: number; count: number }>()
    const allItemIds = itemRows.map((r) => r.id)
    if (settings?.reviewsEnabled && allItemIds.length > 0) {
      const aggRows = await db
        .select({
          itemId: onlineProductReviews.itemId,
          avg: sql<number>`avg(${onlineProductReviews.rating})`,
          count: sql<number>`count(*)`,
        })
        .from(onlineProductReviews)
        .where(
          and(
            inArray(onlineProductReviews.itemId, allItemIds),
            eq(onlineProductReviews.isHidden, false),
          ),
        )
        .groupBy(onlineProductReviews.itemId)
      for (const a of aggRows) {
        ratingByItem.set(a.itemId, {
          avg: Number(a.avg),
          count: Number(a.count),
        })
      }
    }

    const products = itemRows.map((r) => {
      const variants = r.hasVariants ? (variantsByItem.get(r.id) ?? []) : []
      // For variant items, the card shows the cheapest variant ("mulai
      // Rp …") and availability = sum of variant stock.
      const variantPrices = variants.map((v) => v.price).filter((p) => p > 0)
      const unitPrice =
        r.hasVariants && variantPrices.length > 0
          ? String(Math.min(...variantPrices))
          : (priceByItem.get(r.id) ?? '0')
      const available = r.hasVariants
        ? branchId
          ? variants.reduce((n, v) => n + (v.available ?? 0), 0)
          : null
        : branchId
          ? (availByItem.get(r.id) ?? 0)
          : null
      const rating = ratingByItem.get(r.id)
      return {
        id: r.id,
        name: r.name,
        unitPrice,
        imageUrl: photoByItem.get(r.id) ?? null,
        available,
        weightGrams: r.shippingWeightGrams,
        category: r.category,
        hasVariants: r.hasVariants,
        variantConfig: r.hasVariants ? r.variantConfig : null,
        variants,
        ratingAvg: rating?.avg ?? 0,
        reviewCount: rating?.count ?? 0,
      }
    })

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
        id: onlineOrders.id,
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
        itemId: onlineOrderItems.itemId,
        nameSnapshot: onlineOrderItems.nameSnapshot,
        variantLabel: onlineOrderItems.variantLabel,
        qty: onlineOrderItems.qty,
        subtotal: onlineOrderItems.subtotal,
      })
      .from(onlineOrderItems)
      .where(eq(onlineOrderItems.orderId, order.id))

    // Reviews are only offered once the buyer has the product (completed
    // order) AND the tenant has reviews enabled. Mark which items they've
    // already reviewed so the UI can hide the form for those.
    let reviewsOn = false
    if (order.status === 'completed') {
      const [s] = await db
        .select({ reviewsEnabled: storefrontSettings.reviewsEnabled })
        .from(storefrontSettings)
        .where(eq(storefrontSettings.tenantId, tenant.id))
        .limit(1)
      reviewsOn = s?.reviewsEnabled ?? false
    }
    const canReview = order.status === 'completed' && reviewsOn
    let reviewedItemIds = new Set<string>()
    if (canReview) {
      const existing = await db
        .select({ itemId: onlineProductReviews.itemId })
        .from(onlineProductReviews)
        .where(eq(onlineProductReviews.orderId, order.id))
      reviewedItemIds = new Set(existing.map((r) => r.itemId))
    }

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
      canReview,
      items: items.map((i) => ({
        itemId: i.itemId,
        name: i.nameSnapshot,
        variantLabel: i.variantLabel,
        qty: Number(i.qty),
        subtotal: Number(i.subtotal),
        reviewed: i.itemId ? reviewedItemIds.has(i.itemId) : false,
      })),
    }
  })

// ─── buyer confirms receipt ─────────────────────────────────────────

/**
 * Buyer-side "Pesanan diterima" — lets the customer mark a shipped/ready
 * order as completed from the tracking page (mirrors the seller's
 * completeOnlineOrder, but verified by order number + phone). Only
 * shipped (delivery) or ready (pickup) orders can be confirmed received;
 * already-completed is treated as success (idempotent). No stock change —
 * stock was deducted on confirmation. Completing unlocks the review form.
 */
export const confirmOrderReceived = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string(),
      orderNumber: z.string().min(1).max(40),
      phone: z.string().min(4).max(25),
    }),
  )
  .handler(async ({ data }) => {
    const tenant = await resolveTenant(data.slug)
    if (!tenant) return { ok: false as const, message: 'Toko tidak ditemukan' }
    const phone = normalizePhone(data.phone)
    if (!phone) return { ok: false as const, message: 'Nomor tidak valid' }

    const [order] = await db
      .select({ id: onlineOrders.id, status: onlineOrders.status })
      .from(onlineOrders)
      .where(
        and(
          eq(onlineOrders.tenantId, tenant.id),
          sql`upper(${onlineOrders.orderNumber}) = upper(${data.orderNumber.trim()})`,
          eq(onlineOrders.customerPhone, phone),
        ),
      )
      .limit(1)
    if (!order) {
      return { ok: false as const, message: 'Pesanan tidak ditemukan' }
    }
    if (order.status === 'completed') {
      return { ok: true as const }
    }
    if (order.status !== 'shipped' && order.status !== 'ready') {
      return {
        ok: false as const,
        message: 'Pesanan belum bisa dikonfirmasi diterima',
      }
    }
    const now = new Date()
    await db
      .update(onlineOrders)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(onlineOrders.id, order.id))
    return { ok: true as const }
  })

// ─── product reviews ───────────────────────────────────────────────

/**
 * Submit a product review. Gated to buyers: the order must belong to the
 * given phone (same proof as tracking), be `completed`, and contain the
 * item. One review per (order, item) — a duplicate is reported as already
 * reviewed. Auto-published.
 */
export const submitProductReview = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string(),
      orderNumber: z.string().min(1).max(40),
      phone: z.string().min(4).max(25),
      itemId: z.string().uuid(),
      rating: z.coerce.number().int().min(1).max(5),
      comment: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const tenant = await resolveTenant(data.slug)
    if (!tenant) return { ok: false as const, message: 'Toko tidak ditemukan' }
    const phone = normalizePhone(data.phone)
    if (!phone) return { ok: false as const, message: 'Nomor tidak valid' }

    const [settings] = await db
      .select({ reviewsEnabled: storefrontSettings.reviewsEnabled })
      .from(storefrontSettings)
      .where(eq(storefrontSettings.tenantId, tenant.id))
      .limit(1)
    if (!settings?.reviewsEnabled) {
      return { ok: false as const, message: 'Ulasan tidak aktif untuk toko ini' }
    }

    const [order] = await db
      .select({
        id: onlineOrders.id,
        status: onlineOrders.status,
        customerName: onlineOrders.customerName,
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
    if (!order) {
      return { ok: false as const, message: 'Pesanan tidak ditemukan' }
    }
    if (order.status !== 'completed') {
      return {
        ok: false as const,
        message: 'Ulasan bisa diberi setelah pesanan selesai',
      }
    }

    const [line] = await db
      .select({ id: onlineOrderItems.id })
      .from(onlineOrderItems)
      .where(
        and(
          eq(onlineOrderItems.orderId, order.id),
          eq(onlineOrderItems.itemId, data.itemId),
        ),
      )
      .limit(1)
    if (!line) {
      return { ok: false as const, message: 'Produk tidak ada di pesanan ini' }
    }

    try {
      await db.insert(onlineProductReviews).values({
        tenantId: tenant.id,
        itemId: data.itemId,
        orderId: order.id,
        customerName: order.customerName,
        customerPhone: phone,
        rating: data.rating,
        comment: data.comment?.trim() || null,
      })
    } catch {
      // Unique (order, item) violation → already reviewed.
      return { ok: false as const, message: 'Produk ini sudah kamu ulas' }
    }
    return { ok: true as const }
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
        variantId: z.string().uuid().nullable().optional(),
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
        hasVariants: inventoryItems.hasVariants,
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

    // Resolve any variant lines: authoritative price + available stock at
    // the fulfillment branch, keyed by variantId.
    const variantIds = data.items
      .map((i) => i.variantId)
      .filter((v): v is string => !!v)
    const variantById = new Map<
      string,
      { itemId: string; price: number; label: string; available: number }
    >()
    if (variantIds.length > 0) {
      const vRows = await db
        .select({
          id: inventoryItemVariants.id,
          itemId: inventoryItemVariants.itemId,
          value1: inventoryItemVariants.value1,
          value2: inventoryItemVariants.value2,
          price: inventoryItemVariants.price,
          isActive: inventoryItemVariants.isActive,
          quantity: inventoryItemVariantStock.quantity,
        })
        .from(inventoryItemVariants)
        .leftJoin(
          inventoryItemVariantStock,
          and(
            eq(inventoryItemVariantStock.variantId, inventoryItemVariants.id),
            eq(inventoryItemVariantStock.branchId, branchId),
          ),
        )
        .where(
          and(
            eq(inventoryItemVariants.tenantId, tenant.id),
            inArray(inventoryItemVariants.id, variantIds),
            eq(inventoryItemVariants.isActive, true),
          ),
        )
      for (const v of vRows) {
        variantById.set(v.id, {
          itemId: v.itemId,
          price: Number(v.price),
          label: v.value2 ? `${v.value1} / ${v.value2}` : v.value1,
          available: Number(v.quantity ?? 0),
        })
      }
    }

    let subtotal = 0
    const lineItems = data.items.map((line) => {
      const item = byId.get(line.itemId)
      if (!item) throw new Error('Produk tidak tersedia lagi')

      // Variant items require a valid variant; non-variant items must not
      // carry one.
      if (item.hasVariants && !line.variantId)
        throw new Error(`Pilih variasi untuk "${item.name}"`)

      let unitPrice: number
      let avail: number
      let variantId: string | null = null
      let variantLabel: string | null = null

      if (line.variantId) {
        const v = variantById.get(line.variantId)
        if (!v || v.itemId !== item.id)
          throw new Error(`Variasi untuk "${item.name}" tidak tersedia lagi`)
        unitPrice = v.price
        avail = v.available
        variantId = line.variantId
        variantLabel = v.label
      } else {
        unitPrice = Number(priceByItem.get(item.id) ?? '0')
        avail = availByItem.get(item.id) ?? 0
      }

      const label = variantLabel ? `${item.name} (${variantLabel})` : item.name
      if (avail < line.qty)
        throw new Error(`Stok "${label}" tidak cukup (sisa ${avail})`)

      const lineSubtotal = unitPrice * line.qty
      subtotal += lineSubtotal
      return {
        itemId: item.id,
        variantId,
        variantLabel,
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
          variantId: li.variantId,
          variantLabel: li.variantLabel,
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
