import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  loyaltyStampPrograms,
  loyaltyStampProgramItems,
  loyaltyStampProgramRewards,
  customerStampCards,
  customerStampMovements,
  tenantCategories,
  inventoryItems,
  customers,
} from '@vintra/db/schema'
import { aliasedTable, and, eq, inArray, desc, sql } from 'drizzle-orm'
import { posTierLimits } from '@vintra/shared'
import { requirePOSAccess } from '../middleware/module-access'
import {
  uploadStampImage,
  getStampImageSignedUrl,
  deleteStampImage,
  uploadStampCardAsset,
  deleteStampCardPrefix,
  parseDataUrl,
} from '@/lib/s3-storage'

// Reward item joined separately from the scope item — both are
// FK'd to inventory_items but mean different things, so we alias
// to keep selects unambiguous.
const scopeItems = aliasedTable(inventoryItems, 'scope_items')

// ─── JUR-195: Stamp / punch-card programs ────────────────────────────
//
// A stamp program counts qualifying purchases (per quantity, not
// Rupiah) and is scoped to one product category, so a customer's
// motor-wash card and car-wash card accumulate independently.
// Gated behind the same Komplit `loyalty_points` feature as the
// points system.

type StampAuth = Awaited<ReturnType<typeof requirePOSAccess>>

function assertLoyaltyFeature(auth: StampAuth) {
  if (!posTierLimits(auth.posTier).features.includes('loyalty_points')) {
    throw new Error(
      'Fitur kartu stempel hanya tersedia di paket Komplit. Upgrade untuk mengaktifkan.',
    )
  }
}

function assertCanManage(auth: StampAuth) {
  if (!auth.permissions.includes('pos.manage')) {
    throw new Error('Hanya pemilik/admin yang bisa mengatur kartu stempel.')
  }
}

/**
 * Settings page — lists every stamp program (active + archived) with
 * the resolved category and reward-item names so the table needs no
 * client-side joins.
 */
export const listStampPrograms = createServerFn().handler(async () => {
  const auth = await requirePOSAccess()
  assertLoyaltyFeature(auth)

  const rows = await db
    .select({
      id: loyaltyStampPrograms.id,
      name: loyaltyStampPrograms.name,
      scope: loyaltyStampPrograms.scope,
      categoryId: loyaltyStampPrograms.categoryId,
      categoryName: tenantCategories.name,
      productId: loyaltyStampPrograms.productId,
      productName: scopeItems.name,
      stampsRequired: loyaltyStampPrograms.stampsRequired,
      rewardMode: loyaltyStampPrograms.rewardMode,
      rewardItemId: loyaltyStampPrograms.rewardItemId,
      rewardItemName: inventoryItems.name,
      imageKey: loyaltyStampPrograms.imageKey,
      cardDesignKey: loyaltyStampPrograms.cardDesignKey,
      stampMarkKey: loyaltyStampPrograms.stampMarkKey,
      cardLayout: loyaltyStampPrograms.cardLayout,
      cardRenderStatus: loyaltyStampPrograms.cardRenderStatus,
      isActive: loyaltyStampPrograms.isActive,
      createdAt: loyaltyStampPrograms.createdAt,
    })
    .from(loyaltyStampPrograms)
    .leftJoin(
      tenantCategories,
      eq(tenantCategories.id, loyaltyStampPrograms.categoryId),
    )
    .leftJoin(scopeItems, eq(scopeItems.id, loyaltyStampPrograms.productId))
    .leftJoin(
      inventoryItems,
      eq(inventoryItems.id, loyaltyStampPrograms.rewardItemId),
    )
    .where(eq(loyaltyStampPrograms.tenantId, auth.tenantId))
    .orderBy(desc(loyaltyStampPrograms.isActive), loyaltyStampPrograms.createdAt)

  // Hydrate product_set scope + bundle reward children for every row
  // in two batched queries so the list endpoint stays O(1) round-trips.
  const programIds = rows.map((r) => r.id)
  const [scopeItemRows, rewardRows] =
    programIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              programId: loyaltyStampProgramItems.programId,
              itemId: loyaltyStampProgramItems.itemId,
              itemName: inventoryItems.name,
            })
            .from(loyaltyStampProgramItems)
            .innerJoin(
              inventoryItems,
              eq(inventoryItems.id, loyaltyStampProgramItems.itemId),
            )
            .where(inArray(loyaltyStampProgramItems.programId, programIds)),
          db
            .select({
              programId: loyaltyStampProgramRewards.programId,
              itemId: loyaltyStampProgramRewards.itemId,
              itemName: inventoryItems.name,
              quantity: loyaltyStampProgramRewards.quantity,
              sortOrder: loyaltyStampProgramRewards.sortOrder,
            })
            .from(loyaltyStampProgramRewards)
            .innerJoin(
              inventoryItems,
              eq(inventoryItems.id, loyaltyStampProgramRewards.itemId),
            )
            .where(inArray(loyaltyStampProgramRewards.programId, programIds))
            .orderBy(
              loyaltyStampProgramRewards.sortOrder,
              loyaltyStampProgramRewards.createdAt,
            ),
        ])

  const scopeItemsByProgram = new Map<
    string,
    Array<{ itemId: string; itemName: string }>
  >()
  for (const r of scopeItemRows) {
    const list = scopeItemsByProgram.get(r.programId) ?? []
    list.push({ itemId: r.itemId, itemName: r.itemName })
    scopeItemsByProgram.set(r.programId, list)
  }
  const rewardItemsByProgram = new Map<
    string,
    Array<{ itemId: string; itemName: string; quantity: number }>
  >()
  for (const r of rewardRows) {
    const list = rewardItemsByProgram.get(r.programId) ?? []
    list.push({ itemId: r.itemId, itemName: r.itemName, quantity: r.quantity })
    rewardItemsByProgram.set(r.programId, list)
  }

  // Presign images in parallel — admin list is page-bounded so the
  // cost is small. Missing/expired keys silently degrade to null so
  // the UI just omits the thumbnail.
  const imageUrlByProgram = new Map<string, string>()
  // Card design + stamp mark presigned alongside the banner so the
  // editor can rehydrate its preview in edit mode.
  const cardDesignUrlByProgram = new Map<string, string>()
  const stampMarkUrlByProgram = new Map<string, string>()
  await Promise.all([
    ...rows
      .filter((r) => !!r.imageKey)
      .map(async (r) => {
        try {
          const url = await getStampImageSignedUrl(r.imageKey as string)
          imageUrlByProgram.set(r.id, url)
        } catch {
          // ignore — renderer omits the <img>
        }
      }),
    ...rows
      .filter((r) => !!r.cardDesignKey)
      .map(async (r) => {
        try {
          const url = await getStampImageSignedUrl(r.cardDesignKey as string)
          cardDesignUrlByProgram.set(r.id, url)
        } catch {
          // ignore
        }
      }),
    ...rows
      .filter((r) => !!r.stampMarkKey)
      .map(async (r) => {
        try {
          const url = await getStampImageSignedUrl(r.stampMarkKey as string)
          stampMarkUrlByProgram.set(r.id, url)
        } catch {
          // ignore
        }
      }),
  ])

  return rows.map((r) => ({
    ...r,
    imageUrl: imageUrlByProgram.get(r.id) ?? null,
    cardDesignUrl: cardDesignUrlByProgram.get(r.id) ?? null,
    stampMarkUrl: stampMarkUrlByProgram.get(r.id) ?? null,
    scopeItems: scopeItemsByProgram.get(r.id) ?? [],
    bundleRewards: rewardItemsByProgram.get(r.id) ?? [],
  }))
})

/**
 * Dropdown data for the stamp-program form — the tenant's product
 * categories (the scope) and active inventory items (the reward).
 * POS-gated so a POS-only tenant (no Inventory module) can still
 * configure programs.
 */
export const getStampFormMasters = createServerFn().handler(async () => {
  const auth = await requirePOSAccess()
  assertLoyaltyFeature(auth)

  const [categories, items] = await Promise.all([
    db
      .select({ id: tenantCategories.id, name: tenantCategories.name })
      .from(tenantCategories)
      .where(eq(tenantCategories.tenantId, auth.tenantId))
      .orderBy(tenantCategories.sortOrder),
    db
      .select({ id: inventoryItems.id, name: inventoryItems.name })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.tenantId, auth.tenantId),
          eq(inventoryItems.isActive, true),
        ),
      )
      .orderBy(inventoryItems.name),
  ])

  return { categories, items }
})

/**
 * Program payload — three scope kinds + two reward modes. Zod refines
 * enforce that the discriminator-specific fields are populated; the
 * DB does not CHECK these (product_set + bundle straddle multiple
 * tables) so this validator is the source of truth for shape.
 */
// Normalized grid the card editor emits; mirrors StampCardLayout in the
// db schema. All coordinates/sizes are 0..1 fractions of the design.
const cardLayoutSchema = z.object({
  cols: z.number().int().min(1).max(20),
  rows: z.number().int().min(1).max(20),
  cells: z
    .array(
      z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(400),
  markScale: z.number().min(0.01).max(1),
  markOpacity: z.number().min(0.05).max(1),
  // Editor-only grid rect for rehydration; renderer ignores it.
  grid: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
})

// Digital stamp-card fields, shared by create + update. All optional —
// a program without a card design just behaves as before.
const cardFields = {
  cardDesignDataUrl: z.string().startsWith('data:').optional().nullable(),
  stampMarkDataUrl: z.string().startsWith('data:').optional().nullable(),
  cardLayout: cardLayoutSchema.optional().nullable(),
  /** Tear down the whole card (design + mark + rendered states). */
  removeCard: z.boolean().optional(),
}

const programInput = z
  .object({
    name: z
      .string()
      .min(1, 'Nama program wajib diisi')
      .max(80, 'Nama terlalu panjang'),
    scope: z.enum(['category', 'product', 'product_set']),
    categoryId: z.string().uuid('Kategori tidak valid').optional().nullable(),
    productId: z.string().uuid('Produk tidak valid').optional().nullable(),
    itemIds: z.array(z.string().uuid()).optional().nullable(),
    stampsRequired: z.coerce
      .number()
      .int('Jumlah stempel harus bilangan bulat')
      .min(1, 'Minimal 1 stempel')
      .max(100, 'Maksimal 100 stempel'),
    rewardMode: z.enum(['single', 'bundle']),
    rewardItemId: z
      .string()
      .uuid('Produk hadiah tidak valid')
      .optional()
      .nullable(),
    bundleItems: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          quantity: z.coerce
            .number()
            .int('Jumlah harus bilangan bulat')
            .min(1, 'Minimal 1')
            .max(99, 'Maksimal 99'),
        }),
      )
      .optional()
      .nullable(),
    /** Inline base64 image upload. Empty/null leaves existing image alone. */
    imageDataUrl: z.string().startsWith('data:').optional().nullable(),
    /** Set true to clear the existing image without uploading a replacement. */
    removeImage: z.boolean().optional(),
    ...cardFields,
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'category' && !v.categoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Kategori wajib dipilih untuk cakupan per kategori.',
        path: ['categoryId'],
      })
    }
    if (v.scope === 'product' && !v.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produk wajib dipilih untuk cakupan per produk.',
        path: ['productId'],
      })
    }
    if (v.scope === 'product_set') {
      const ids = v.itemIds ?? []
      if (ids.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Pilih minimal 1 produk untuk cakupan multi-produk.',
          path: ['itemIds'],
        })
      }
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Produk dalam cakupan tidak boleh duplikat.',
          path: ['itemIds'],
        })
      }
    }
    if (v.rewardMode === 'single' && !v.rewardItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produk hadiah wajib dipilih.',
        path: ['rewardItemId'],
      })
    }
    if (v.rewardMode === 'bundle') {
      const bundle = v.bundleItems ?? []
      if (bundle.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tambahkan minimal 1 produk pada bundle hadiah.',
          path: ['bundleItems'],
        })
      }
      const ids = bundle.map((b) => b.itemId)
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Produk dalam bundle tidak boleh duplikat.',
          path: ['bundleItems'],
        })
      }
    }
  })

type ProgramInput = z.infer<typeof programInput>

/**
 * Confirms every tenant-owned id on the payload (scope target + reward
 * items) actually belongs to the tenant. One batched probe per category
 * + product_set + bundle, so an N-item program costs at most 3 round
 * trips.
 */
async function assertScopeAndReward(tenantId: string, data: ProgramInput) {
  if (data.scope === 'category') {
    const [cat] = await db
      .select({ id: tenantCategories.id })
      .from(tenantCategories)
      .where(
        and(
          eq(tenantCategories.id, data.categoryId!),
          eq(tenantCategories.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!cat) throw new Error('Kategori tidak ditemukan')
  } else if (data.scope === 'product') {
    const [prod] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.productId!),
          eq(inventoryItems.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!prod) throw new Error('Produk tidak ditemukan')
  } else {
    const ids = data.itemIds ?? []
    const rows = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          inArray(inventoryItems.id, ids),
          eq(inventoryItems.tenantId, tenantId),
        ),
      )
    if (rows.length !== ids.length) {
      throw new Error('Sebagian produk dalam cakupan tidak ditemukan.')
    }
  }

  if (data.rewardMode === 'single') {
    const [item] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.id, data.rewardItemId!),
          eq(inventoryItems.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Produk hadiah tidak ditemukan')
  } else {
    const ids = (data.bundleItems ?? []).map((b) => b.itemId)
    const rows = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(
          inArray(inventoryItems.id, ids),
          eq(inventoryItems.tenantId, tenantId),
        ),
      )
    if (rows.length !== ids.length) {
      throw new Error('Sebagian produk dalam bundle hadiah tidak ditemukan.')
    }
  }
}

/**
 * Image side-effects: upload/replace or clear. Runs AFTER the program
 * row exists so we can use its id in the S3 key. Mirrors the promo
 * pattern (image failures don't roll back the program insert/update —
 * a missing image is recoverable, a missing program isn't).
 */
async function applyImageSideEffect(
  tenantId: string,
  programId: string,
  data: { imageDataUrl?: string | null; removeImage?: boolean },
  currentImageKey: string | null,
): Promise<string | null> {
  let imageKey = currentImageKey
  if (data.removeImage && imageKey) {
    await deleteStampImage(imageKey).catch(() => {
      // S3 delete failures are non-fatal — orphaned object will be
      // swept later. Don't block the user.
    })
    imageKey = null
    await db
      .update(loyaltyStampPrograms)
      .set({ imageKey: null, updatedAt: new Date() })
      .where(eq(loyaltyStampPrograms.id, programId))
  }
  if (data.imageDataUrl) {
    const { bytes, mimeType } = parseDataUrl(data.imageDataUrl)
    const { key } = await uploadStampImage({
      tenantId,
      programId,
      bytes,
      mimeType,
    })
    imageKey = key
    await db
      .update(loyaltyStampPrograms)
      .set({ imageKey: key, updatedAt: new Date() })
      .where(eq(loyaltyStampPrograms.id, programId))
  }
  return imageKey
}

/**
 * Best-effort trigger for the Go API's card pre-render. The endpoint
 * flips the program to 'pending' and enqueues loyalty:render_card.
 * Returns whether the trigger was accepted; the caller flips the row to
 * 'failed' on a miss so the UI can prompt a retry. No-op (false) when
 * the API URL / token aren't configured (local dev without the API).
 */
async function triggerStampCardRender(
  tenantId: string,
  programId: string,
): Promise<boolean> {
  const apiBase = process.env.API_URL
  const token = process.env.INTERNAL_SERVICE_TOKEN
  if (!apiBase || !token) return false
  try {
    const res = await fetch(`${apiBase}/v1/internal/loyalty/render-card`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tenantId, programId }),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Card-design side-effects: upload the base design + stamp mark, persist
 * the keys and grid layout, and kick off the pre-render. `removeCard`
 * tears the whole thing down (design, mark, every rendered state). Runs
 * AFTER the program row exists, like the banner side-effect — S3/render
 * failures don't roll back the program; the merchant can re-save to
 * retry. Render is only triggered once the card is complete (design +
 * mark + layout all present).
 */
async function applyCardSideEffect(
  tenantId: string,
  programId: string,
  data: {
    cardDesignDataUrl?: string | null
    stampMarkDataUrl?: string | null
    cardLayout?: z.infer<typeof cardLayoutSchema> | null
    removeCard?: boolean
  },
  current: {
    cardDesignKey: string | null
    stampMarkKey: string | null
    cardLayout: z.infer<typeof cardLayoutSchema> | null
  },
): Promise<void> {
  if (data.removeCard) {
    await deleteStampCardPrefix(tenantId, programId)
    await db
      .update(loyaltyStampPrograms)
      .set({
        cardDesignKey: null,
        stampMarkKey: null,
        cardLayout: null,
        cardRenderStatus: 'none',
        cardRenderedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(loyaltyStampPrograms.id, programId))
    return
  }

  const layoutProvided = data.cardLayout != null
  if (
    !data.cardDesignDataUrl &&
    !data.stampMarkDataUrl &&
    !layoutProvided
  ) {
    // Nothing card-related changed.
    return
  }

  let designKey = current.cardDesignKey
  let markKey = current.stampMarkKey
  if (data.cardDesignDataUrl) {
    const { bytes, mimeType } = parseDataUrl(data.cardDesignDataUrl)
    designKey = (
      await uploadStampCardAsset({
        tenantId,
        programId,
        asset: 'design',
        bytes,
        mimeType,
      })
    ).key
  }
  if (data.stampMarkDataUrl) {
    const { bytes, mimeType } = parseDataUrl(data.stampMarkDataUrl)
    markKey = (
      await uploadStampCardAsset({
        tenantId,
        programId,
        asset: 'mark',
        bytes,
        mimeType,
      })
    ).key
  }
  const resolvedLayout = layoutProvided ? data.cardLayout! : current.cardLayout

  await db
    .update(loyaltyStampPrograms)
    .set({
      cardDesignKey: designKey,
      stampMarkKey: markKey,
      cardLayout: resolvedLayout,
      updatedAt: new Date(),
    })
    .where(eq(loyaltyStampPrograms.id, programId))

  // Render only when the card is complete.
  if (designKey && markKey && resolvedLayout) {
    const ok = await triggerStampCardRender(tenantId, programId)
    if (!ok) {
      await db
        .update(loyaltyStampPrograms)
        .set({ cardRenderStatus: 'failed' })
        .where(eq(loyaltyStampPrograms.id, programId))
    }
  }
}

/**
 * Replaces both join tables for a program in a transaction. Used by
 * create + update so the caller never sees a half-written state.
 */
async function replaceProgramChildren(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  programId: string,
  data: ProgramInput,
) {
  await tx
    .delete(loyaltyStampProgramItems)
    .where(eq(loyaltyStampProgramItems.programId, programId))
  await tx
    .delete(loyaltyStampProgramRewards)
    .where(eq(loyaltyStampProgramRewards.programId, programId))

  if (data.scope === 'product_set' && data.itemIds && data.itemIds.length) {
    await tx.insert(loyaltyStampProgramItems).values(
      data.itemIds.map((itemId) => ({
        tenantId,
        programId,
        itemId,
      })),
    )
  }
  if (
    data.rewardMode === 'bundle' &&
    data.bundleItems &&
    data.bundleItems.length
  ) {
    await tx.insert(loyaltyStampProgramRewards).values(
      data.bundleItems.map((b, i) => ({
        tenantId,
        programId,
        itemId: b.itemId,
        quantity: b.quantity,
        sortOrder: i,
      })),
    )
  }
}

export const createStampProgram = createServerFn({ method: 'POST' })
  .inputValidator(programInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)
    assertCanManage(auth)
    await assertScopeAndReward(auth.tenantId, data)

    // Single-scope clash check — only category + single-product are
    // enforced unique. product_set rows may freely overlap; the
    // accrual logic uses most-specific-wins to dedupe.
    if (data.scope === 'category' || data.scope === 'product') {
      const clashCondition =
        data.scope === 'category'
          ? eq(loyaltyStampPrograms.categoryId, data.categoryId!)
          : eq(loyaltyStampPrograms.productId, data.productId!)
      const [clash] = await db
        .select({ id: loyaltyStampPrograms.id })
        .from(loyaltyStampPrograms)
        .where(
          and(
            eq(loyaltyStampPrograms.tenantId, auth.tenantId),
            clashCondition,
            eq(loyaltyStampPrograms.isActive, true),
          ),
        )
        .limit(1)
      if (clash) {
        throw new Error(
          data.scope === 'category'
            ? 'Sudah ada program aktif untuk kategori ini.'
            : 'Sudah ada program aktif untuk produk ini.',
        )
      }
    }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(loyaltyStampPrograms)
        .values({
          tenantId: auth.tenantId,
          name: data.name,
          scope: data.scope,
          categoryId: data.scope === 'category' ? data.categoryId! : null,
          productId: data.scope === 'product' ? data.productId! : null,
          stampsRequired: data.stampsRequired,
          rewardMode: data.rewardMode,
          rewardItemId:
            data.rewardMode === 'single' ? data.rewardItemId! : null,
        })
        .returning()
      if (!row) throw new Error('Gagal membuat program.')
      await replaceProgramChildren(tx, auth.tenantId, row.id, data)
      return row
    })
    // Image upload runs outside the tx because the S3 helpers don't
    // participate; if the program row is in place we can safely upsert
    // the image and patch image_key after.
    await applyImageSideEffect(auth.tenantId, created.id, data, null)
    await applyCardSideEffect(auth.tenantId, created.id, data, {
      cardDesignKey: null,
      stampMarkKey: null,
      cardLayout: null,
    })
    return created
  })

/**
 * Update payload: scope (and its target columns) is FIXED after
 * creation — changing it would orphan customer cards. Owner can still
 * edit name, stamp threshold, reward bundle/single, and active flag.
 * The reward MODE is editable but the editor locks it in practice
 * because changing single ↔ bundle reshapes the cashier redemption.
 */
const updateProgramInput = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .min(1, 'Nama program wajib diisi')
    .max(80, 'Nama terlalu panjang'),
  stampsRequired: z.coerce
    .number()
    .int('Jumlah stempel harus bilangan bulat')
    .min(1, 'Minimal 1 stempel')
    .max(100, 'Maksimal 100 stempel'),
  rewardMode: z.enum(['single', 'bundle']),
  rewardItemId: z
    .string()
    .uuid('Produk hadiah tidak valid')
    .optional()
    .nullable(),
  bundleItems: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .optional()
    .nullable(),
  imageDataUrl: z.string().startsWith('data:').optional().nullable(),
  removeImage: z.boolean().optional(),
  isActive: z.boolean(),
  ...cardFields,
})

export const updateStampProgram = createServerFn({ method: 'POST' })
  .inputValidator(updateProgramInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)
    assertCanManage(auth)

    const [program] = await db
      .select()
      .from(loyaltyStampPrograms)
      .where(
        and(
          eq(loyaltyStampPrograms.id, data.id),
          eq(loyaltyStampPrograms.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!program) throw new Error('Program tidak ditemukan')

    // Reward-side ownership check.
    if (data.rewardMode === 'single') {
      if (!data.rewardItemId) {
        throw new Error('Produk hadiah wajib dipilih.')
      }
      const [item] = await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.id, data.rewardItemId),
            eq(inventoryItems.tenantId, auth.tenantId),
          ),
        )
        .limit(1)
      if (!item) throw new Error('Produk hadiah tidak ditemukan')
    } else {
      const bundle = data.bundleItems ?? []
      if (bundle.length === 0) {
        throw new Error('Tambahkan minimal 1 produk pada bundle hadiah.')
      }
      const ids = bundle.map((b) => b.itemId)
      if (new Set(ids).size !== ids.length) {
        throw new Error('Produk dalam bundle tidak boleh duplikat.')
      }
      const rows = await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(
          and(
            inArray(inventoryItems.id, ids),
            eq(inventoryItems.tenantId, auth.tenantId),
          ),
        )
      if (rows.length !== ids.length) {
        throw new Error('Sebagian produk dalam bundle tidak ditemukan.')
      }
    }

    if (data.isActive && !program.isActive) {
      // Re-activation collides with any other active program on the
      // SAME scope (category-scope or product-scope only — product_set
      // doesn't enforce uniqueness, accrual handles overlap).
      const clashCondition = program.categoryId
        ? eq(loyaltyStampPrograms.categoryId, program.categoryId)
        : program.productId
          ? eq(loyaltyStampPrograms.productId, program.productId)
          : null
      if (clashCondition) {
        const [clash] = await db
          .select({ id: loyaltyStampPrograms.id })
          .from(loyaltyStampPrograms)
          .where(
            and(
              eq(loyaltyStampPrograms.tenantId, auth.tenantId),
              clashCondition,
              eq(loyaltyStampPrograms.isActive, true),
            ),
          )
          .limit(1)
        if (clash) {
          throw new Error(
            program.categoryId
              ? 'Sudah ada program aktif untuk kategori ini.'
              : 'Sudah ada program aktif untuk produk ini.',
          )
        }
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(loyaltyStampPrograms)
        .set({
          name: data.name,
          stampsRequired: data.stampsRequired,
          rewardMode: data.rewardMode,
          rewardItemId:
            data.rewardMode === 'single' ? data.rewardItemId! : null,
          isActive: data.isActive,
          updatedAt: new Date(),
        })
        .where(eq(loyaltyStampPrograms.id, data.id))
        .returning()
      if (!row) throw new Error('Gagal menyimpan program.')
      // Refresh bundle rows when in bundle mode; clear them when
      // switching back to single. Scope items (product_set) are
      // immutable post-creation so we never touch loyaltyStampProgramItems
      // from update.
      await tx
        .delete(loyaltyStampProgramRewards)
        .where(eq(loyaltyStampProgramRewards.programId, data.id))
      if (data.rewardMode === 'bundle' && data.bundleItems?.length) {
        await tx.insert(loyaltyStampProgramRewards).values(
          data.bundleItems.map((b, i) => ({
            tenantId: auth.tenantId,
            programId: data.id,
            itemId: b.itemId,
            quantity: b.quantity,
            sortOrder: i,
          })),
        )
      }
      return row
    })

    // Image side-effects run after the tx so S3 helpers don't block
    // the program update. Failures here surface to the user but the
    // edit itself is already persisted.
    await applyImageSideEffect(
      auth.tenantId,
      data.id,
      data,
      program.imageKey,
    )
    await applyCardSideEffect(auth.tenantId, data.id, data, {
      cardDesignKey: program.cardDesignKey,
      stampMarkKey: program.stampMarkKey,
      cardLayout: program.cardLayout,
    })
    return updated
  })

/**
 * Cashier + customer-detail view. Returns one entry per ACTIVE
 * program — including programs the customer has never touched (zeros)
 * — so the cashier can always show "Cuci Motor 0/5". `canRedeem` is
 * pre-computed so the UI needs no threshold math.
 */
export const getCustomerStampCards = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ customerId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)

    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, data.customerId),
          eq(customers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!customer) throw new Error('Pelanggan tidak ditemukan')

    const rows = await db
      .select({
        programId: loyaltyStampPrograms.id,
        programName: loyaltyStampPrograms.name,
        scope: loyaltyStampPrograms.scope,
        categoryId: loyaltyStampPrograms.categoryId,
        productId: loyaltyStampPrograms.productId,
        stampsRequired: loyaltyStampPrograms.stampsRequired,
        rewardMode: loyaltyStampPrograms.rewardMode,
        rewardItemId: loyaltyStampPrograms.rewardItemId,
        rewardItemName: inventoryItems.name,
        imageKey: loyaltyStampPrograms.imageKey,
        cardRenderStatus: loyaltyStampPrograms.cardRenderStatus,
        cardId: customerStampCards.id,
        currentStamps: customerStampCards.currentStamps,
        lifetimeStamps: customerStampCards.lifetimeStamps,
        lifetimeRewards: customerStampCards.lifetimeRewards,
      })
      .from(loyaltyStampPrograms)
      .leftJoin(
        inventoryItems,
        eq(inventoryItems.id, loyaltyStampPrograms.rewardItemId),
      )
      .leftJoin(
        customerStampCards,
        and(
          eq(customerStampCards.programId, loyaltyStampPrograms.id),
          eq(customerStampCards.customerId, data.customerId),
        ),
      )
      .where(
        and(
          eq(loyaltyStampPrograms.tenantId, auth.tenantId),
          eq(loyaltyStampPrograms.isActive, true),
        ),
      )
      .orderBy(loyaltyStampPrograms.createdAt)

    // Bundle rewards per program — only needed for rewardMode='bundle'
    // but it's cheaper to fetch all in one batched query than branch.
    const programIds = rows.map((r) => r.programId)
    const rewardRows = programIds.length
      ? await db
          .select({
            programId: loyaltyStampProgramRewards.programId,
            itemId: loyaltyStampProgramRewards.itemId,
            itemName: inventoryItems.name,
            quantity: loyaltyStampProgramRewards.quantity,
          })
          .from(loyaltyStampProgramRewards)
          .innerJoin(
            inventoryItems,
            eq(inventoryItems.id, loyaltyStampProgramRewards.itemId),
          )
          .where(inArray(loyaltyStampProgramRewards.programId, programIds))
          .orderBy(
            loyaltyStampProgramRewards.sortOrder,
            loyaltyStampProgramRewards.createdAt,
          )
      : []
    const bundleByProgram = new Map<
      string,
      Array<{ itemId: string; itemName: string; quantity: number }>
    >()
    for (const r of rewardRows) {
      const list = bundleByProgram.get(r.programId) ?? []
      list.push({ itemId: r.itemId, itemName: r.itemName, quantity: r.quantity })
      bundleByProgram.set(r.programId, list)
    }

    // Set items per product_set program — needed by the cashier to
    // project per-line earn (mirrors stampProgramByProductSetItem in
    // createSale's precedence chain).
    const setItemRows = programIds.length
      ? await db
          .select({
            programId: loyaltyStampProgramItems.programId,
            itemId: loyaltyStampProgramItems.itemId,
          })
          .from(loyaltyStampProgramItems)
          .where(inArray(loyaltyStampProgramItems.programId, programIds))
      : []
    const setItemsByProgram = new Map<string, string[]>()
    for (const r of setItemRows) {
      const list = setItemsByProgram.get(r.programId) ?? []
      list.push(r.itemId)
      setItemsByProgram.set(r.programId, list)
    }

    // Presign images for the strip thumbnails.
    const imageUrlByProgram = new Map<string, string>()
    await Promise.all(
      rows
        .filter((r) => !!r.imageKey)
        .map(async (r) => {
          try {
            const url = await getStampImageSignedUrl(r.imageKey as string)
            imageUrlByProgram.set(r.programId, url)
          } catch {
            // ignore — cashier strip omits the thumb
          }
        }),
    )

    return rows.map((r) => {
      const current = r.currentStamps ?? 0
      return {
        programId: r.programId,
        programName: r.programName,
        scope: r.scope,
        categoryId: r.categoryId,
        productId: r.productId,
        stampsRequired: r.stampsRequired,
        rewardMode: r.rewardMode,
        rewardItemId: r.rewardItemId,
        rewardItemName: r.rewardItemName,
        imageUrl: imageUrlByProgram.get(r.programId) ?? null,
        cardRenderStatus: r.cardRenderStatus,
        bundleRewards: bundleByProgram.get(r.programId) ?? [],
        setItemIds: setItemsByProgram.get(r.programId) ?? [],
        currentStamps: current,
        lifetimeStamps: r.lifetimeStamps ?? 0,
        lifetimeRewards: r.lifetimeRewards ?? 0,
        canRedeem: current >= r.stampsRequired,
      }
    })
  })

const adjustStampInput = z.object({
  customerId: z.string().uuid(),
  programId: z.string().uuid(),
  /** Signed delta. Positive grants stamps; negative revokes. */
  stamps: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, 'Jumlah stempel tidak boleh 0'),
  reason: z.string().min(1, 'Alasan wajib diisi').max(200, 'Alasan terlalu panjang'),
})

/**
 * Admin override — bumps a customer's stamp count up or down. Used to
 * fix a missed scan or honour a paper card. Refuses to drive the
 * count below 0.
 */
export const adjustStampCard = createServerFn({ method: 'POST' })
  .inputValidator(adjustStampInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)
    assertCanManage(auth)

    const [program] = await db
      .select({ id: loyaltyStampPrograms.id })
      .from(loyaltyStampPrograms)
      .where(
        and(
          eq(loyaltyStampPrograms.id, data.programId),
          eq(loyaltyStampPrograms.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!program) throw new Error('Program tidak ditemukan')

    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, data.customerId),
          eq(customers.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!customer) throw new Error('Pelanggan tidak ditemukan')

    const isGrant = data.stamps > 0
    const absStamps = Math.abs(data.stamps)

    await db.transaction(async (tx) => {
      const [card] = await tx
        .select()
        .from(customerStampCards)
        .where(
          and(
            eq(customerStampCards.customerId, data.customerId),
            eq(customerStampCards.programId, data.programId),
          ),
        )
        .limit(1)

      const current = card?.currentStamps ?? 0
      if (!isGrant && absStamps > current) {
        throw new Error(
          `Stempel tidak cukup. Saat ini: ${current}.`,
        )
      }
      const nextCurrent = current + (isGrant ? absStamps : -absStamps)

      let cardId: string
      if (card) {
        cardId = card.id
        await tx
          .update(customerStampCards)
          .set({
            currentStamps: nextCurrent,
            lifetimeStamps: isGrant
              ? card.lifetimeStamps + absStamps
              : card.lifetimeStamps,
            updatedAt: new Date(),
          })
          .where(eq(customerStampCards.id, card.id))
      } else {
        const [inserted] = await tx
          .insert(customerStampCards)
          .values({
            tenantId: auth.tenantId,
            customerId: data.customerId,
            programId: data.programId,
            currentStamps: nextCurrent,
            lifetimeStamps: isGrant ? absStamps : 0,
          })
          .returning({ id: customerStampCards.id })
        cardId = inserted!.id
      }

      await tx.insert(customerStampMovements).values({
        tenantId: auth.tenantId,
        cardId,
        type: 'adjust',
        stamps: absStamps,
        reason: data.reason,
        performedBy: auth.userId,
      })
    })

    return { ok: true }
  })

/**
 * Hard delete a program — but ONLY when no customer has ever earned a
 * stamp on it. This is the "I made a typo / wrong category" escape
 * hatch for fresh setups; once any history exists, the owner has to
 * deactivate instead (preserves lifetimeStamps / lifetimeRewards on
 * the customer detail page). The DB cascades would happily destroy
 * months of history, so we never let that happen.
 */
export const deleteStampProgram = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)
    assertCanManage(auth)

    const [program] = await db
      .select({ id: loyaltyStampPrograms.id })
      .from(loyaltyStampPrograms)
      .where(
        and(
          eq(loyaltyStampPrograms.id, data.id),
          eq(loyaltyStampPrograms.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!program) throw new Error('Program tidak ditemukan')

    // Single existence probe — cheaper than counting and the rule is
    // binary anyway: any card = block.
    const [usage] = await db
      .select({ id: customerStampCards.id })
      .from(customerStampCards)
      .where(eq(customerStampCards.programId, data.id))
      .limit(1)
    if (usage) {
      throw new Error(
        'Program ini sudah dipakai pelanggan dan tidak bisa dihapus. Nonaktifkan saja agar tidak menambah stempel baru — riwayat pelanggan tetap aman.',
      )
    }

    await db.delete(loyaltyStampPrograms).where(eq(loyaltyStampPrograms.id, data.id))
    return { ok: true }
  })

// ─── Aktivitas Stempel ───────────────────────────────────────────────
//
// Read-only analytics for the loyalty page: how many stamps were
// earned/redeemed in a period (today / week / month / year) for a
// given program, and who's been earning them. Period boundaries are
// Asia/Jakarta wall-clock — business owners measure "today" by calendar
// day in WIB, not UTC.

const stampActivityInput = z.object({
  programId: z.string().uuid(),
  period: z.enum(['today', 'week', 'month', 'year']),
})

export const getStampActivity = createServerFn({ method: 'POST' })
  .inputValidator(stampActivityInput)
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)

    const [program] = await db
      .select({
        id: loyaltyStampPrograms.id,
        name: loyaltyStampPrograms.name,
        stampsRequired: loyaltyStampPrograms.stampsRequired,
      })
      .from(loyaltyStampPrograms)
      .where(
        and(
          eq(loyaltyStampPrograms.id, data.programId),
          eq(loyaltyStampPrograms.tenantId, auth.tenantId),
        ),
      )
      .limit(1)
    if (!program) throw new Error('Program tidak ditemukan')

    // date_trunc unit aligned with the period; 'today' truncs to day.
    const unit =
      data.period === 'today'
        ? 'day'
        : data.period === 'week'
          ? 'week'
          : data.period === 'month'
            ? 'month'
            : 'year'
    // WIB wall-clock boundary, returned as timestamptz for safe
    // comparison against the no-tz `created_at` column (PG coerces the
    // no-tz column to the session zone, which is UTC on the prod box).
    const sinceSql = sql`(date_trunc(${sql.raw(`'${unit}'`)}, now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta'`

    const earnedExpr = sql<number>`coalesce(sum(case when ${customerStampMovements.type} = 'earn' then ${customerStampMovements.stamps} else 0 end), 0)::int`
    const redeemedExpr = sql<number>`coalesce(sum(case when ${customerStampMovements.type} = 'redeem' then ${customerStampMovements.stamps} else 0 end), 0)::int`
    const rewardsExpr = sql<number>`coalesce(count(*) filter (where ${customerStampMovements.type} = 'redeem'), 0)::int`
    const activeCustomersExpr = sql<number>`count(distinct ${customerStampCards.customerId})::int`

    const [summary] = await db
      .select({
        stampsEarned: earnedExpr,
        stampsRedeemed: redeemedExpr,
        rewardsClaimed: rewardsExpr,
        activeCustomers: activeCustomersExpr,
      })
      .from(customerStampMovements)
      .innerJoin(
        customerStampCards,
        eq(customerStampCards.id, customerStampMovements.cardId),
      )
      .where(
        and(
          eq(customerStampCards.programId, data.programId),
          eq(customerStampMovements.tenantId, auth.tenantId),
          sql`${customerStampMovements.createdAt} >= ${sinceSql}`,
        ),
      )

    const memberEarnedExpr = sql<number>`sum(case when ${customerStampMovements.type} = 'earn' then ${customerStampMovements.stamps} else 0 end)::int`
    const memberRewardsExpr = sql<number>`count(*) filter (where ${customerStampMovements.type} = 'redeem')::int`

    const topMembers = await db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        stampsInPeriod: memberEarnedExpr,
        rewardsInPeriod: memberRewardsExpr,
        currentStamps: customerStampCards.currentStamps,
        lifetimeStamps: customerStampCards.lifetimeStamps,
        lifetimeRewards: customerStampCards.lifetimeRewards,
      })
      .from(customerStampMovements)
      .innerJoin(
        customerStampCards,
        eq(customerStampCards.id, customerStampMovements.cardId),
      )
      .innerJoin(customers, eq(customers.id, customerStampCards.customerId))
      .where(
        and(
          eq(customerStampCards.programId, data.programId),
          eq(customerStampMovements.tenantId, auth.tenantId),
          sql`${customerStampMovements.createdAt} >= ${sinceSql}`,
        ),
      )
      .groupBy(
        customers.id,
        customers.name,
        customers.phone,
        customerStampCards.currentStamps,
        customerStampCards.lifetimeStamps,
        customerStampCards.lifetimeRewards,
      )
      .having(sql`${memberEarnedExpr} > 0 OR ${memberRewardsExpr} > 0`)
      .orderBy(desc(memberEarnedExpr), desc(memberRewardsExpr))
      .limit(20)

    return {
      program: {
        id: program.id,
        name: program.name,
        stampsRequired: program.stampsRequired,
      },
      period: data.period,
      summary: summary ?? {
        stampsEarned: 0,
        stampsRedeemed: 0,
        rewardsClaimed: 0,
        activeCustomers: 0,
      },
      topMembers,
    }
  })

/**
 * Manual "Kirim kartu" from the dashboard. Forwards to the Go API's
 * internal send-card endpoint, which picks the pre-rendered image for
 * the customer's current stamp count and sends it from the tenant's
 * connected WhatsApp instance. Surfaces the API's friendly Indonesian
 * errors (no card rendered, no connected WhatsApp, etc.).
 */
export const sendStampCard = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      customerId: z.string().uuid(),
      programId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requirePOSAccess()
    assertLoyaltyFeature(auth)
    assertCanManage(auth)

    const apiBase = process.env.API_URL
    const token = process.env.INTERNAL_SERVICE_TOKEN
    if (!apiBase || !token) {
      throw new Error('Pengiriman kartu belum dikonfigurasi di server.')
    }

    const res = await fetch(`${apiBase}/v1/internal/loyalty/send-card`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenantId: auth.tenantId,
        customerId: data.customerId,
        programId: data.programId,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(body?.error ?? 'Gagal mengirim kartu stempel.')
    }
    return { ok: true }
  })
