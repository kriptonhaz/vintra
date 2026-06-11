/**
 * JUR-9: Tenant promotions — server functions.
 *
 * One table covers three trigger modes:
 *   - `code`: customer types a code at checkout
 *   - `auto_product`: applies when a specific product enters the cart
 *   - `auto_cart`: cart-wide auto-apply (e.g. happy hour)
 *
 * The cashier hits `listActivePromotions` once per session for the
 * auto-applied set + `validatePromoCode` per keystroke (debounced) for
 * code redemption. createSale re-resolves both server-side at save
 * time so a tampered client can't fake a discount.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  tenantPromotions,
  promoRedemptions,
  inventoryItems,
  promotionTargets,
  tenantCategories,
} from '@vintra/db/schema'
import { and, eq, sql, desc, isNull, inArray, asc, ilike } from 'drizzle-orm'
import { posTierLimits, type POSTierKey } from '@vintra/shared'
import { requirePOSAccess } from '../middleware/module-access'
import {
  uploadPromoImage,
  getPromoImageSignedUrl,
  deletePromoImage,
  parseDataUrl,
} from '@/lib/s3-storage'

/**
 * Compute the Rp discount amount for a promotion given a base amount
 * (cart subtotal for code/auto_cart; line gross for auto_product).
 * Mirrors the sale + line discount math elsewhere — capped to the
 * base amount so we never go negative, optionally clamped at
 * `maxDiscountAmount` for percent-type promotions.
 */
export function computePromoAmount(
  promo: {
    discountType: string
    discountValue: string | number
    maxDiscountAmount?: string | number | null
  },
  base: number,
): number {
  const value = Number(promo.discountValue)
  const max =
    promo.maxDiscountAmount != null ? Number(promo.maxDiscountAmount) : null
  if (base <= 0 || value <= 0) return 0
  let amount =
    promo.discountType === 'percent'
      ? Math.round((base * value) / 100)
      : Math.min(value, base)
  if (max != null && amount > max) amount = max
  if (amount > base) amount = base
  return amount
}

function requirePromosFeature(posTier: POSTierKey) {
  if (!posTierLimits(posTier).features.includes('promo_codes')) {
    throw new Error(
      'Fitur promo hanya tersedia di paket Komplit. Upgrade dari halaman billing.',
    )
  }
}

// ─── Owner CRUD ──────────────────────────────────────────────────────

/**
 * Scope-based input. The UI distinguishes `product` (one) and
 * `multi_product` (many) for UX, but both map to triggerType
 * `auto_products` in the DB — single vs. many is a target-row count
 * distinction, not a kind distinction. `code` and `cart` map 1:1.
 */
const upsertInput = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1, 'Nama promo wajib diisi').max(100),
    scope: z.enum(['code', 'product', 'multi_product', 'category', 'cart']),
    code: z.string().min(2).max(50).optional().nullable(),
    /** When scope = product (length 1) or multi_product (>= 1). */
    itemIds: z.array(z.string().uuid()).max(200).optional(),
    /** When scope = category (>= 1). */
    categoryIds: z.array(z.string().uuid()).max(50).optional(),
    discountType: z.enum(['percent', 'fixed']),
    discountValue: z.coerce.number().positive('Nilai diskon harus > 0'),
    maxDiscountAmount: z.coerce.number().min(0).optional().nullable(),
    minCartTotal: z.coerce.number().min(0).optional().nullable(),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
    totalRedemptionCap: z.coerce.number().int().min(1).optional().nullable(),
    perCustomerCap: z.coerce.number().int().min(1).optional().nullable(),
    isActive: z.boolean().optional(),
    /**
     * Optional promo banner — base64 data URL produced client-side by
     * FileReader. Uploaded to S3 with kind=promo tag after the row is
     * persisted (we need the row id to build the S3 key). Omit to
     * leave the existing image alone; pass `removeImage: true` to
     * explicitly clear the existing one without uploading a new one.
     */
    imageDataUrl: z.string().startsWith('data:').optional().nullable(),
    removeImage: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.scope === 'code' && !d.code) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Kode wajib diisi untuk promo tipe kode',
      })
    }
    if (d.scope === 'product' && (!d.itemIds || d.itemIds.length !== 1)) {
      ctx.addIssue({
        code: 'custom',
        path: ['itemIds'],
        message: 'Pilih satu produk untuk promo tipe ini',
      })
    }
    if (d.scope === 'multi_product' && (!d.itemIds || d.itemIds.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['itemIds'],
        message: 'Pilih minimal satu produk',
      })
    }
    if (
      d.scope === 'category' &&
      (!d.categoryIds || d.categoryIds.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryIds'],
        message: 'Pilih minimal satu kategori',
      })
    }
    if (
      d.discountType === 'percent' &&
      (d.discountValue < 0 || d.discountValue > 100)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Persen harus antara 0 dan 100',
      })
    }
  })

/** UI scope → DB triggerType. Single vs. multi product is target-count only. */
function scopeToTrigger(
  scope: 'code' | 'product' | 'multi_product' | 'category' | 'cart',
): string {
  switch (scope) {
    case 'code':
      return 'code'
    case 'product':
    case 'multi_product':
      return 'auto_products'
    case 'category':
      return 'auto_category'
    case 'cart':
      return 'auto_cart'
  }
}

export const upsertPromotion = createServerFn({ method: 'POST' })
  .inputValidator(upsertInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)

    const triggerType = scopeToTrigger(data.scope)
    const values = {
      tenantId: auth.tenantId,
      name: data.name,
      triggerType,
      code:
        data.scope === 'code' ? (data.code ?? '').trim().toUpperCase() : null,
      discountType: data.discountType,
      discountValue: data.discountValue.toString(),
      maxDiscountAmount:
        data.maxDiscountAmount != null
          ? data.maxDiscountAmount.toString()
          : null,
      minCartTotal:
        data.minCartTotal != null ? data.minCartTotal.toString() : null,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
      totalRedemptionCap: data.totalRedemptionCap ?? null,
      perCustomerCap: data.perCustomerCap ?? null,
      isActive: data.isActive ?? true,
      updatedAt: new Date(),
    }

    // Write promo row + replace targets atomically. Image side-effects
    // run outside the tx because they're network calls (S3) and a
    // failure there shouldn't abort an otherwise-valid promo write.
    const promo = await db.transaction(async (tx) => {
      let row: typeof tenantPromotions.$inferSelect
      if (data.id) {
        const [updated] = await tx
          .update(tenantPromotions)
          .set(values)
          .where(
            and(
              eq(tenantPromotions.id, data.id),
              eq(tenantPromotions.tenantId, auth.tenantId),
            ),
          )
          .returning()
        if (!updated) throw new Error('Promo tidak ditemukan')
        row = updated
      } else {
        const [created] = await tx
          .insert(tenantPromotions)
          .values(values)
          .returning()
        row = created!
      }

      // Replace targets every save — simpler than a diff and N is small.
      await tx
        .delete(promotionTargets)
        .where(eq(promotionTargets.promotionId, row.id))

      if (data.scope === 'product' || data.scope === 'multi_product') {
        const ids = data.itemIds ?? []
        if (ids.length > 0) {
          const valid = await tx
            .select({ id: inventoryItems.id })
            .from(inventoryItems)
            .where(
              and(
                eq(inventoryItems.tenantId, auth.tenantId),
                inArray(inventoryItems.id, ids),
              ),
            )
          const validSet = new Set(valid.map((r) => r.id))
          const safe = ids.filter((id) => validSet.has(id))
          if (safe.length === 0) {
            throw new Error('Produk yang dipilih tidak valid.')
          }
          await tx.insert(promotionTargets).values(
            safe.map((itemId) => ({
              tenantId: auth.tenantId,
              promotionId: row.id,
              itemId,
            })),
          )
        }
      } else if (data.scope === 'category') {
        const ids = data.categoryIds ?? []
        if (ids.length > 0) {
          const valid = await tx
            .select({ id: tenantCategories.id })
            .from(tenantCategories)
            .where(
              and(
                eq(tenantCategories.tenantId, auth.tenantId),
                inArray(tenantCategories.id, ids),
              ),
            )
          const validSet = new Set(valid.map((r) => r.id))
          const safe = ids.filter((id) => validSet.has(id))
          if (safe.length === 0) {
            throw new Error('Kategori yang dipilih tidak valid.')
          }
          await tx.insert(promotionTargets).values(
            safe.map((categoryId) => ({
              tenantId: auth.tenantId,
              promotionId: row.id,
              categoryId,
            })),
          )
        }
      }
      // code / cart scopes carry no targets.

      return row
    })

    let promoWithImage = promo

    // Image side-effects run AFTER the row exists so we can use its id
    // in the S3 key. Failures here don't roll back the promo write —
    // a half-saved image is recoverable (re-upload), but losing the
    // promo data would be worse UX. Surface the failure as a thrown
    // error so the toast tells the user to retry.
    if (data.removeImage && promoWithImage.imageKey) {
      await deletePromoImage(promoWithImage.imageKey).catch(() => {
        // S3 delete failures are non-fatal — orphaned object will be
        // cleaned up by a future sweep. Don't block the user.
      })
      const [cleared] = await db
        .update(tenantPromotions)
        .set({ imageKey: null, updatedAt: new Date() })
        .where(eq(tenantPromotions.id, promoWithImage.id))
        .returning()
      promoWithImage = cleared!
    }
    if (data.imageDataUrl) {
      const { bytes, mimeType } = parseDataUrl(data.imageDataUrl)
      // Replace existing object at the same key — no orphaned files.
      const { key } = await uploadPromoImage({
        tenantId: auth.tenantId,
        promoId: promoWithImage.id,
        bytes,
        mimeType,
      })
      const [withImage] = await db
        .update(tenantPromotions)
        .set({ imageKey: key, updatedAt: new Date() })
        .where(eq(tenantPromotions.id, promoWithImage.id))
        .returning()
      promoWithImage = withImage!
    }

    return promoWithImage
  })

export const listPromotions = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      includeInactive: z.boolean().optional().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)

    const conds = [eq(tenantPromotions.tenantId, auth.tenantId)]
    if (!data.includeInactive) {
      conds.push(eq(tenantPromotions.isActive, true))
    }

    const rows = await db
      .select({
        id: tenantPromotions.id,
        name: tenantPromotions.name,
        code: tenantPromotions.code,
        triggerType: tenantPromotions.triggerType,
        discountType: tenantPromotions.discountType,
        discountValue: tenantPromotions.discountValue,
        maxDiscountAmount: tenantPromotions.maxDiscountAmount,
        minCartTotal: tenantPromotions.minCartTotal,
        startsAt: tenantPromotions.startsAt,
        endsAt: tenantPromotions.endsAt,
        totalRedemptionCap: tenantPromotions.totalRedemptionCap,
        perCustomerCap: tenantPromotions.perCustomerCap,
        isActive: tenantPromotions.isActive,
        imageKey: tenantPromotions.imageKey,
        createdAt: tenantPromotions.createdAt,
      })
      .from(tenantPromotions)
      .where(and(...conds))
      .orderBy(desc(tenantPromotions.createdAt))

    // Batched target lookup. Returning the full {id, name} arrays so
    // the list page can render "Roti Canai Coklat" / "5 produk" labels
    // AND the edit form can prefill the picker without a second fetch.
    // Target counts per promo are small (1–5 typical, capped at 200).
    const promoIds = rows.map((r) => r.id)
    type TargetBuckets = {
      itemTargets: Array<{ id: string; name: string }>
      categoryTargets: Array<{ id: string; name: string }>
    }
    const targetsByPromo = new Map<string, TargetBuckets>()
    if (promoIds.length > 0) {
      const targetRows = await db
        .select({
          promotionId: promotionTargets.promotionId,
          itemId: promotionTargets.itemId,
          itemName: inventoryItems.name,
          categoryId: promotionTargets.categoryId,
          categoryName: tenantCategories.name,
        })
        .from(promotionTargets)
        .leftJoin(
          inventoryItems,
          eq(inventoryItems.id, promotionTargets.itemId),
        )
        .leftJoin(
          tenantCategories,
          eq(tenantCategories.id, promotionTargets.categoryId),
        )
        .where(inArray(promotionTargets.promotionId, promoIds))
      for (const t of targetRows) {
        const bucket = targetsByPromo.get(t.promotionId) ?? {
          itemTargets: [],
          categoryTargets: [],
        }
        if (t.itemId && t.itemName) {
          bucket.itemTargets.push({ id: t.itemId, name: t.itemName })
        } else if (t.categoryId && t.categoryName) {
          bucket.categoryTargets.push({
            id: t.categoryId,
            name: t.categoryName,
          })
        }
        targetsByPromo.set(t.promotionId, bucket)
      }
    }

    // Sign URLs in parallel — one per promo with an image. Failures
    // collapse to null so the row still renders without a thumbnail
    // rather than failing the whole list.
    const withSigned = await Promise.all(
      rows.map(async (r) => {
        let imageUrl: string | null = null
        if (r.imageKey) {
          imageUrl = await getPromoImageSignedUrl(r.imageKey).catch(() => null)
        }
        const t = targetsByPromo.get(r.id) ?? {
          itemTargets: [],
          categoryTargets: [],
        }
        return {
          ...r,
          discountValue: Number(r.discountValue),
          maxDiscountAmount:
            r.maxDiscountAmount != null ? Number(r.maxDiscountAmount) : null,
          minCartTotal: r.minCartTotal != null ? Number(r.minCartTotal) : null,
          imageUrl,
          itemTargets: t.itemTargets,
          categoryTargets: t.categoryTargets,
        }
      }),
    )
    return withSigned
  })

export const getPromotion = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)

    const [row] = await db
      .select()
      .from(tenantPromotions)
      .where(
        and(
          eq(tenantPromotions.id, data.id),
          eq(tenantPromotions.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Promo tidak ditemukan')

    // Returning targets so the edit form can prefill the picker with
    // names rather than firing a separate lookup for every target id.
    const targets = await db
      .select({
        itemId: promotionTargets.itemId,
        itemName: inventoryItems.name,
        categoryId: promotionTargets.categoryId,
        categoryName: tenantCategories.name,
      })
      .from(promotionTargets)
      .leftJoin(inventoryItems, eq(inventoryItems.id, promotionTargets.itemId))
      .leftJoin(
        tenantCategories,
        eq(tenantCategories.id, promotionTargets.categoryId),
      )
      .where(eq(promotionTargets.promotionId, row.id))

    const itemTargets: Array<{ id: string; name: string }> = []
    const categoryTargets: Array<{ id: string; name: string }> = []
    for (const t of targets) {
      if (t.itemId) {
        itemTargets.push({ id: t.itemId, name: t.itemName ?? '' })
      } else if (t.categoryId) {
        categoryTargets.push({ id: t.categoryId, name: t.categoryName ?? '' })
      }
    }
    return { ...row, itemTargets, categoryTargets }
  })

export const deactivatePromotion = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)
    await db
      .update(tenantPromotions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(tenantPromotions.id, data.id),
          eq(tenantPromotions.tenantId, auth.tenantId),
        ),
      )
    return { success: true as const }
  })

// ─── Cashier reads ───────────────────────────────────────────────────

/**
 * Returns currently-active auto-applied promotions (auto_product +
 * auto_cart). Cashier client caches this result and matches against
 * cart adds locally — server re-validates on createSale anyway, so
 * client-side caching is safe even if the cache is mildly stale.
 *
 * Code-mode promos are excluded — those are validated on demand via
 * `validatePromoCode` instead.
 */
export const listActivePromotions = createServerFn({ method: 'POST' })
  .handler(async () => {
    const auth = await requirePOSAccess()
    if (!posTierLimits(auth.posTier).features.includes('promo_codes')) {
      // Non-Komplit tier just gets an empty list; no error so the
      // cashier doesn't have to feature-gate this call.
      return []
    }

    const now = new Date()
    const rows = await db
      .select({
        id: tenantPromotions.id,
        name: tenantPromotions.name,
        triggerType: tenantPromotions.triggerType,
        discountType: tenantPromotions.discountType,
        discountValue: tenantPromotions.discountValue,
        maxDiscountAmount: tenantPromotions.maxDiscountAmount,
        minCartTotal: tenantPromotions.minCartTotal,
        startsAt: tenantPromotions.startsAt,
        endsAt: tenantPromotions.endsAt,
      })
      .from(tenantPromotions)
      .where(
        and(
          eq(tenantPromotions.tenantId, auth.tenantId),
          eq(tenantPromotions.isActive, true),
          // code-mode rows handled by validatePromoCode
          isNull(tenantPromotions.code),
        ),
      )

    // Batched target lookup, grouped by promoId, so createSale can
    // build itemId / categoryId maps without N+1.
    const promoIds = rows.map((r) => r.id)
    const targetsByPromo = new Map<
      string,
      { itemIds: string[]; categoryIds: string[] }
    >()
    if (promoIds.length > 0) {
      const targetRows = await db
        .select({
          promotionId: promotionTargets.promotionId,
          itemId: promotionTargets.itemId,
          categoryId: promotionTargets.categoryId,
        })
        .from(promotionTargets)
        .where(inArray(promotionTargets.promotionId, promoIds))
      for (const t of targetRows) {
        const bucket = targetsByPromo.get(t.promotionId) ?? {
          itemIds: [],
          categoryIds: [],
        }
        if (t.itemId) bucket.itemIds.push(t.itemId)
        else if (t.categoryId) bucket.categoryIds.push(t.categoryId)
        targetsByPromo.set(t.promotionId, bucket)
      }
    }

    // In-memory date filter — cheaper than a date-aware SQL filter
    // for the small number of active rows a tenant has at once.
    return rows
      .filter((r) => {
        if (r.startsAt && r.startsAt > now) return false
        if (r.endsAt && r.endsAt < now) return false
        return true
      })
      .map((r) => {
        const t = targetsByPromo.get(r.id) ?? { itemIds: [], categoryIds: [] }
        return {
          ...r,
          discountValue: Number(r.discountValue),
          maxDiscountAmount:
            r.maxDiscountAmount != null ? Number(r.maxDiscountAmount) : null,
          minCartTotal: r.minCartTotal != null ? Number(r.minCartTotal) : null,
          itemIds: t.itemIds,
          categoryIds: t.categoryIds,
        }
      })
  })

/**
 * Live cashier validation of a promo code. Returns either the resolved
 * promotion + computed discount, or a friendly Indonesian error reason
 * the cashier can show in the input. Caps + active window + min-cart
 * validation matches what createSale will re-check at save time.
 */
export const validatePromoCode = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      code: z.string().min(1).max(50),
      cartSubtotal: z.coerce.number().min(0),
      customerId: z.string().uuid().optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)

    const code = data.code.trim().toUpperCase()
    const [promo] = await db
      .select()
      .from(tenantPromotions)
      .where(
        and(
          eq(tenantPromotions.tenantId, auth.tenantId),
          eq(tenantPromotions.code, code),
          eq(tenantPromotions.triggerType, 'code'),
        ),
      )
      .limit(1)

    if (!promo) return { valid: false as const, error: 'Kode promo tidak ditemukan.' }
    if (!promo.isActive) {
      return { valid: false as const, error: 'Promo sudah tidak aktif.' }
    }

    const now = new Date()
    if (promo.startsAt && promo.startsAt > now) {
      return { valid: false as const, error: 'Promo belum dimulai.' }
    }
    if (promo.endsAt && promo.endsAt < now) {
      return { valid: false as const, error: 'Promo sudah berakhir.' }
    }

    const minCart = promo.minCartTotal ? Number(promo.minCartTotal) : 0
    if (minCart > 0 && data.cartSubtotal < minCart) {
      return {
        valid: false as const,
        error: `Minimal belanja Rp ${minCart.toLocaleString('id-ID')} untuk pakai promo ini.`,
      }
    }

    if (promo.totalRedemptionCap != null) {
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(promoRedemptions)
        .where(eq(promoRedemptions.promoId, promo.id))
      if (count >= promo.totalRedemptionCap) {
        return {
          valid: false as const,
          error: 'Kuota promo sudah habis.',
        }
      }
    }

    if (promo.perCustomerCap != null && data.customerId) {
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(promoRedemptions)
        .where(
          and(
            eq(promoRedemptions.promoId, promo.id),
            eq(promoRedemptions.customerId, data.customerId),
          ),
        )
      if (count >= promo.perCustomerCap) {
        return {
          valid: false as const,
          error: 'Pelanggan ini sudah pakai promo ini sebelumnya.',
        }
      }
    }

    const amount = computePromoAmount(promo, data.cartSubtotal)
    return {
      valid: true as const,
      promo: {
        id: promo.id,
        name: promo.name,
        code: promo.code,
        discountType: promo.discountType,
        discountValue: Number(promo.discountValue),
      },
      amount,
    }
  })

// ─── Promo picker lookups ────────────────────────────────────────────

/**
 * Searchable list of sellable products for the promo target picker.
 * Filters out non-sellable raw materials (the main cause of duplicates
 * in the previous picker — an inventory-only twin of a sellable SKU)
 * and surfaces SKU + category as a sublabel so legitimately same-named
 * items stay distinguishable in the dropdown.
 */
export const listSellablePromoProducts = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      search: z.string().max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)

    const conds = [
      eq(inventoryItems.tenantId, auth.tenantId),
      eq(inventoryItems.isActive, true),
      eq(inventoryItems.isSellable, true),
    ]
    if (data.search?.trim()) {
      conds.push(ilike(inventoryItems.name, `%${data.search.trim()}%`))
    }
    const rows = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        categoryName: tenantCategories.name,
      })
      .from(inventoryItems)
      .leftJoin(
        tenantCategories,
        eq(tenantCategories.id, inventoryItems.categoryId),
      )
      .where(and(...conds))
      .orderBy(asc(inventoryItems.name))
      .limit(50)
    return rows
  })

/**
 * Tenant categories for the category-scope promo picker.
 */
export const listPromoCategories = createServerFn({ method: 'POST' })
  .handler(async () => {
    const auth = await requirePOSAccess()
    requirePromosFeature(auth.posTier)

    const rows = await db
      .select({
        id: tenantCategories.id,
        name: tenantCategories.name,
      })
      .from(tenantCategories)
      .where(eq(tenantCategories.tenantId, auth.tenantId))
      .orderBy(asc(tenantCategories.sortOrder), asc(tenantCategories.name))
    return rows
  })
