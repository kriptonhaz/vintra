/**
 * JUR-176: editor server fns for the tenant public site.
 *
 * Three operations:
 *   - getMySiteSettings  — auth-gated read for the editor
 *   - saveSiteDraft      — auth-gated write to `tenant_sites.settings`
 *   - publishSite        — promote draft → published + snapshot history
 *
 * Permission gate: `booking.write` (same as the slug claim in
 * JUR-185). Once the public site grows beyond booking-adjacent
 * scope we'll introduce a dedicated `site.write` permission; for
 * now the people allowed to claim the slug are the people allowed
 * to edit what's at that slug.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  tenantSites,
  sitePublishHistory,
  tenants,
  bookingSettings,
  bookingResources,
  bookings,
  branches,
  inventoryItems,
  inventoryItemUnitPricing,
  posSettings,
  tenantCategories,
  tenantPromotions,
  loyaltyStampPrograms,
  loyaltyStampProgramRewards,
} from '@vintra/db/schema'
import {
  eq,
  desc,
  sql,
  and,
  asc,
  inArray,
  notInArray,
  or,
  lte,
  isNull,
} from 'drizzle-orm'
import { purgeTenantSiteCache } from '../lib/cloudflare-purge'
import { requirePermission } from '../middleware/auth'
import { requireTenantSiteAccess } from '../middleware/module-access'
import {
  collectImageKeysV2,
  buildBlankSettings,
} from '@/lib/site-templates/sections-v2/registry'
import { normalizeSettingsV2 } from '@/lib/site-templates/sections-v2/normalize'
import {
  getTenantSiteAssetSignedUrl,
  getInventoryPhotoSignedUrl,
  getPromoImageSignedUrl,
  getStampImageSignedUrl,
  parseDataUrl,
  uploadTenantSiteAsset,
  deleteTenantSiteAsset,
  type TenantSiteAssetKind,
} from '@/lib/s3-storage'
import { formatRupiah } from '@/lib/currency'
import { randomUUID } from 'crypto'
import type { SiteSettingsV2 } from '@/lib/site-templates/v2-types'

/**
 * Helper: sign every image key referenced by a v2 settings tree
 * (including repeater sub-items). Used by getMySiteSettings for the
 * editor preview path; the public renderer uses the equivalent in
 * public-tenant.ts.
 */
async function signSiteAssets(
  settings: SiteSettingsV2,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const keys = collectImageKeysV2(settings)
  await Promise.all(
    keys.map(async (k) => {
      try {
        out[k] = await getTenantSiteAssetSignedUrl(k)
      } catch {
        // Asset disappeared or signing failed — just skip.
      }
    }),
  )
  return out
}

// ─── Read ────────────────────────────────────────────────────────────

/**
 * Returns the editor's view of the tenant's site as v2 settings.
 * Three pieces:
 *   - `settings` (current draft, v2 shape — normalized from whatever's
 *     in the DB row, even if it's still v1)
 *   - `assetUrls` (pre-signed image URLs for the draft, keyed by S3
 *     key, so the preview renders uploads instantly)
 *   - `published` (snapshot of what's currently live + when, for the
 *     "lihat halaman publik" CTA and the "ada perubahan belum
 *     dipublikasikan" indicator)
 *
 * `templateId` on the row is kept for back-compat but isn't used by
 * the v2 editor — picking a preset just overwrites the settings blob.
 */
export const getMySiteSettings = createServerFn().handler(async () => {
  await requireTenantSiteAccess()
  const { tenantId } = await requirePermission('booking.write')

  const [row] = await db
    .select({
      templateId: tenantSites.templateId,
      settings: tenantSites.settings,
      publishedTemplateId: tenantSites.publishedTemplateId,
      publishedSettings: tenantSites.publishedSettings,
      publishedAt: tenantSites.publishedAt,
      maintenanceMode: tenantSites.maintenanceMode,
      maintenanceMessage: tenantSites.maintenanceMessage,
    })
    .from(tenantSites)
    .where(eq(tenantSites.tenantId, tenantId))
    .limit(1)

  if (!row) {
    const blank = buildBlankSettings(() => randomUUID())
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings: blank as any,
      assetUrls: {} as Record<string, string>,
      published: null as null | {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        settings: any
        publishedAt: Date
      },
      maintenance: { mode: false, message: null as string | null },
    }
  }

  const normalizedDraft = normalizeSettingsV2(row.settings)
  // Editor needs signed URLs for the IN-PROGRESS draft (so an upload
  // shows up in the preview immediately) — different from the public
  // renderer which only signs the published snapshot.
  const assetUrls = await signSiteAssets(normalizedDraft)

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: normalizedDraft as any,
    assetUrls,
    published:
      row.publishedAt && row.publishedSettings
        ? {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            settings: normalizeSettingsV2(row.publishedSettings) as any,
            publishedAt: row.publishedAt,
          }
        : null,
    maintenance: {
      mode: row.maintenanceMode,
      message: row.maintenanceMessage,
    },
  }
})

// ─── Write (draft) ───────────────────────────────────────────────────

const saveSiteDraftSchema = z.object({
  /**
   * Last-applied preset id — purely for "what did the tenant start
   * from" display. Not load-bearing; the normalizer doesn't read it.
   * Kept loose (string) so future presets don't need a server change.
   */
  presetId: z.string().min(1).max(60).optional(),
  /**
   * V2 settings tree from the editor. Schema is `record<string,
   * unknown>` — the v2 normalizer does the real validation (clamps
   * maxLen, coerces booleans, drops unknown section types, enforces
   * footer-last invariant).
   */
  settings: z.record(z.string(), z.unknown()),
})

export const saveSiteDraft = createServerFn({ method: 'POST' })
  .inputValidator(saveSiteDraftSchema)
  .handler(async ({ data }) => {
    // Gate on Komplit (tenant_site feature) AND booking.write permission
    // — Komplit subscriber decides who in their team can edit the site.
    await requireTenantSiteAccess()
    const { tenantId } = await requirePermission('booking.write')

    const settings = normalizeSettingsV2(data.settings)
    const now = new Date()
    // `templateId` column is legacy; keep writing SOMETHING so the
    // not-null constraint stays happy. The v2 editor doesn't read it.
    const templateId = data.presetId ?? 'v2'

    await db
      .insert(tenantSites)
      .values({
        tenantId,
        templateId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        settings: settings as any,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantSites.tenantId,
        set: {
          templateId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          settings: settings as any,
          updatedAt: now,
        },
      })

    return { ok: true as const }
  })

// ─── Publish ─────────────────────────────────────────────────────────

const HISTORY_LIMIT = 5

export const publishSite = createServerFn({ method: 'POST' }).handler(async () => {
  await requireTenantSiteAccess()
  const { tenantId } = await requirePermission('booking.write')

  const [row] = await db
    .select({
      templateId: tenantSites.templateId,
      settings: tenantSites.settings,
    })
    .from(tenantSites)
    .where(eq(tenantSites.tenantId, tenantId))
    .limit(1)

  if (!row) {
    throw new Error('Belum ada draft untuk dipublikasikan. Simpan draft dulu.')
  }

  const now = new Date()
  const settings = normalizeSettingsV2(row.settings)

  // Promote draft → published + append history snapshot. Two writes
  // back-to-back — not in a transaction because:
  //   1. The history insert is append-only; a duplicate from a
  //      double-click is harmless (the trim step below de-dupes).
  //   2. The history trim is best-effort and runs after the publish
  //      itself; if it fails the publish still succeeded.
  // If we end up needing strict consistency later, wrap in db.transaction.
  await db
    .update(tenantSites)
    .set({
      publishedTemplateId: row.templateId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      publishedSettings: settings as any,
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(tenantSites.tenantId, tenantId))

  const [snapshot] = await db
    .insert(sitePublishHistory)
    .values({
      tenantId,
      templateId: row.templateId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings: settings as any,
      publishedAt: now,
    })
    .returning({ id: sitePublishHistory.id })

  // Trim to last HISTORY_LIMIT rows for this tenant. Subquery picks
  // the IDs to keep (newest first), then delete-where-not-in drops
  // everything else. Cheap because the index on (tenant_id,
  // published_at) supports both halves.
  if (snapshot) {
    const keepers = db
      .select({ id: sitePublishHistory.id })
      .from(sitePublishHistory)
      .where(eq(sitePublishHistory.tenantId, tenantId))
      .orderBy(desc(sitePublishHistory.publishedAt))
      .limit(HISTORY_LIMIT)

    await db.delete(sitePublishHistory).where(
      and(
        eq(sitePublishHistory.tenantId, tenantId),
        notInArray(sitePublishHistory.id, keepers),
      ),
    )
  }

  // JUR-177: purge the Cloudflare edge cache for this tenant's
  // subdomain so the new publish shows immediately instead of waiting
  // out the 5-min `s-maxage` TTL. Best-effort — never blocks publish.
  const [tenantRow] = await db
    .select({ publicSlug: tenants.publicSlug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  await purgeTenantSiteCache(tenantRow?.publicSlug ?? null)

  return { ok: true as const, publishedAt: now }
})

// ─── Maintenance mode ────────────────────────────────────────────────

const setSiteMaintenanceModeSchema = z.object({
  enabled: z.boolean(),
  /**
   * Custom maintenance copy. Null / undefined / empty → fall back to
   * the localized default on the public renderer. Clamped to 500 chars
   * so the maintenance page stays scannable.
   */
  message: z.string().max(500).nullable().optional(),
})

/**
 * Flip the public site between "live" and "under construction".
 * Independent of `publishSite` — no re-publish required to toggle.
 * Published settings stay intact so flipping back to false instantly
 * restores whatever was live before.
 */
export const setSiteMaintenanceMode = createServerFn({ method: 'POST' })
  .inputValidator(setSiteMaintenanceModeSchema)
  .handler(async ({ data }) => {
    await requireTenantSiteAccess()
    const { tenantId } = await requirePermission('booking.write')

    const message =
      data.message && data.message.trim().length > 0
        ? data.message.trim()
        : null
    const now = new Date()

    // Upsert: a tenant could plausibly toggle maintenance before they
    // ever publish (e.g. claim slug + set up "coming soon" before
    // building the site). Match the saveSiteDraft upsert pattern so
    // the row exists without forcing a "save draft" round-trip.
    await db
      .insert(tenantSites)
      .values({
        tenantId,
        templateId: 'v2',
        maintenanceMode: data.enabled,
        maintenanceMessage: message,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantSites.tenantId,
        set: {
          maintenanceMode: data.enabled,
          maintenanceMessage: message,
          updatedAt: now,
        },
      })

    // JUR-177: purge the edge cache so the maintenance flip (on or
    // off) takes effect immediately. Best-effort.
    const [tenantRow] = await db
      .select({ publicSlug: tenants.publicSlug })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    await purgeTenantSiteCache(tenantRow?.publicSlug ?? null)

    return { ok: true as const }
  })

// ─── History (for the "Riwayat publikasi" affordance) ────────────────

export const listSitePublishHistory = createServerFn().handler(async () => {
  await requireTenantSiteAccess()
  const { tenantId } = await requirePermission('booking.write')
  return db
    .select({
      id: sitePublishHistory.id,
      templateId: sitePublishHistory.templateId,
      publishedAt: sitePublishHistory.publishedAt,
    })
    .from(sitePublishHistory)
    .where(eq(sitePublishHistory.tenantId, tenantId))
    .orderBy(desc(sitePublishHistory.publishedAt))
    .limit(HISTORY_LIMIT)
})

/**
 * "Pulihkan" — copies a history snapshot back into the draft. Does
 * NOT auto-publish; the tenant has to hit Publikasikan again to
 * push the rolled-back state live. Intentional — the snapshot
 * might be old enough that a sanity-check is warranted before it
 * goes back in front of customers.
 */
export const restoreSitePublishSnapshot = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ snapshotId: z.string().uuid() }))
  .handler(async ({ data }) => {
    // Gate on Komplit (tenant_site feature) AND booking.write permission
    // — Komplit subscriber decides who in their team can edit the site.
    await requireTenantSiteAccess()
    const { tenantId } = await requirePermission('booking.write')

    const [snap] = await db
      .select({
        templateId: sitePublishHistory.templateId,
        settings: sitePublishHistory.settings,
      })
      .from(sitePublishHistory)
      .where(
        and(
          eq(sitePublishHistory.id, data.snapshotId),
          eq(sitePublishHistory.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!snap) {
      throw new Error('Snapshot tidak ditemukan.')
    }

    const settings = normalizeSettingsV2(snap.settings)
    const now = new Date()

    await db
      .insert(tenantSites)
      .values({
        tenantId,
        templateId: snap.templateId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        settings: settings as any,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantSites.tenantId,
        set: {
          templateId: snap.templateId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          settings: settings as any,
          updatedAt: now,
        },
      })

    return {
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settings: settings as any,
    }
  })

// ─── Editor preview ──────────────────────────────────────────────────

/**
 * Returns the live tenant data the editor needs to render the preview
 * pane — same shape as the public route loader output, but keyed by
 * the authed tenantId instead of by slug. Works even when the tenant
 * hasn't claimed a public slug yet, so they can author the page
 * before pushing it live.
 *
 * Settings are NOT included here — the editor manages those in
 * client state. The renderer overlays whatever's currently being
 * edited onto this baseline tenant data.
 */
// ─── Asset upload ────────────────────────────────────────────────────

const uploadSiteAssetSchema = z.object({
  /**
   * Image category. Single-slot kinds (`logo`, `og`) overwrite the
   * existing key; multi-slot (`gallery`) generates a fresh assetId
   * so each upload gets its own object.
   */
  kind: z.enum(['logo', 'hero', 'gallery', 'og']),
  /**
   * Compressed JPEG/PNG/WebP data URL from the upload widget.
   * Compression happens client-side so we don't have to ship a sharp
   * dependency to the prod box.
   */
  dataUrl: z.string().min(1).max(2_000_000),
  /**
   * The asset key being replaced. The single-slot key is
   * `logo.{ext}` — same-extension re-uploads overwrite in place, but
   * an extension change orphans the old object. When set, the old
   * object is deleted after a successful upload (unless it's still
   * the LIVE published asset, which must survive until republish).
   */
  replacesKey: z.string().optional(),
})

/**
 * Editor → S3 upload bridge. Returns the persisted S3 key; the
 * editor stores it into `tenant_sites.settings` under the right
 * field key. We deliberately don't return a signed URL — the renderer
 * batches signing at SSR time so a single upload doesn't burn an
 * extra round-trip.
 */
export const uploadSiteAsset = createServerFn({ method: 'POST' })
  .inputValidator(uploadSiteAssetSchema)
  .handler(async ({ data }) => {
    // Gate on Komplit (tenant_site feature) AND booking.write permission
    // — Komplit subscriber decides who in their team can edit the site.
    await requireTenantSiteAccess()
    const { tenantId } = await requirePermission('booking.write')
    const { bytes, mimeType } = parseDataUrl(data.dataUrl)

    // Single-slot kinds (logo, og) reuse a fixed assetId so re-uploading
    // overwrites the same S3 object — no orphan accumulation. Multi-slot
    // kinds (gallery, hero) are repeaters: each upload gets its own uuid
    // so two photos don't collide on one key (which made uploading hero
    // photo #2 silently overwrite photo #1).
    const kind = data.kind as TenantSiteAssetKind
    const MULTI_SLOT_KINDS: TenantSiteAssetKind[] = ['gallery', 'hero']
    const assetId = MULTI_SLOT_KINDS.includes(kind)
      ? randomUUID().slice(0, 12)
      : kind

    const { key } = await uploadTenantSiteAsset({
      tenantId,
      kind,
      assetId,
      bytes,
      mimeType,
    })

    // Replacing an asset whose key changed (e.g. logo.png → logo.jpg)
    // orphans the old S3 object. Delete it — but never the one the
    // LIVE published site still points at; that key has to survive
    // until the tenant republishes.
    if (data.replacesKey && data.replacesKey !== key) {
      const [row] = await db
        .select({ publishedSettings: tenantSites.publishedSettings })
        .from(tenantSites)
        .where(eq(tenantSites.tenantId, tenantId))
        .limit(1)
      const published = row?.publishedSettings as
        | { theme?: { logoAssetKey?: unknown } }
        | null
        | undefined
      const publishedLogo =
        typeof published?.theme?.logoAssetKey === 'string'
          ? published.theme.logoAssetKey
          : null
      if (data.replacesKey !== publishedLogo) {
        try {
          await deleteTenantSiteAsset(data.replacesKey)
        } catch {
          // Best-effort — a failed cleanup must not fail the upload.
        }
      }
    }

    return { key }
  })

// ─── Editor preview data ─────────────────────────────────────────────

export const getEditorPreviewData = createServerFn().handler(async () => {
  await requireTenantSiteAccess()
  const { tenantId } = await requirePermission('booking.write')

  const [tenant] = await db
    .select({
      businessName: tenants.businessName,
      publicSlug: tenants.publicSlug,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  const [bsettings] = await db
    .select({ mode: bookingSettings.mode, slotDurationMin: bookingSettings.slotDurationMin })
    .from(bookingSettings)
    .where(eq(bookingSettings.tenantId, tenantId))
    .limit(1)

  // Editor preview mirrors the public renderer — see the matching
  // tax block in public-tenant.ts. Lets the tenant preview the
  // "harga belum termasuk pajak" footnote before publishing.
  const [pos] = await db
    .select({ taxes: posSettings.taxes })
    .from(posSettings)
    .where(eq(posSettings.tenantId, tenantId))
    .limit(1)
  const activeTaxes = (pos?.taxes ?? []).filter((t) => t.active)
  const taxSummary = {
    totalPercent: activeTaxes.reduce((sum, t) => sum + Number(t.percent || 0), 0),
    labels: activeTaxes.map((t) => t.label).filter(Boolean),
  }

  const branchRows = await db
    .select({
      id: branches.id,
      name: branches.name,
      address: branches.address,
      businessHours: branches.businessHours,
      isMain: branches.isMain,
      latitude: branches.latitude,
      longitude: branches.longitude,
    })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt))
  // `numeric` columns arrive as strings — coerce for the Maps section.
  const tenantBranches = branchRows.map((b) => ({
    ...b,
    latitude: Number(b.latitude),
    longitude: Number(b.longitude),
  }))

  // Pricing pulled separately and merged in JS — see public-tenant.ts
  // for the rationale (Drizzle's correlated subquery via `${col}` was
  // returning '0' for every row).
  const itemRows = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      color: inventoryItems.bookingColor,
      bookingDurationMin: inventoryItems.bookingDurationMin,
      isBookable: inventoryItems.isBookable,
      photoKey: inventoryItems.photoKey,
      category: tenantCategories.name,
    })
    .from(inventoryItems)
    .leftJoin(
      tenantCategories,
      eq(inventoryItems.categoryId, tenantCategories.id),
    )
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isSellable, true),
        eq(inventoryItems.isActive, true),
        // Editor preview matches the public renderer — see the
        // matching comment in public-tenant.ts. A jasa-only tenant
        // (cuci motor) still gets to surface their POS snacks here.
      ),
    )
    .orderBy(asc(inventoryItems.name))

  const itemIds = itemRows.map((r) => r.id)
  const pricingRows =
    itemIds.length > 0
      ? await db
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
      : []
  const priceByItem = new Map<string, string>()
  for (const row of pricingRows) {
    if (!priceByItem.has(row.itemId)) {
      priceByItem.set(row.itemId, row.unitPrice)
    }
  }

  const fallbackSlot = bsettings?.slotDurationMin ?? null

  // Match public-tenant.ts — pre-sign each item photo (7-day TTL) so
  // the editor preview shows the same imagery the live site will.
  const photoUrlByItem = new Map<string, string>()
  const itemsWithPhotos = itemRows.filter(
    (r): r is typeof r & { photoKey: string } => !!r.photoKey,
  )
  await Promise.all(
    itemsWithPhotos.map(async (r) => {
      try {
        const url = await getInventoryPhotoSignedUrl(r.photoKey, 7 * 24 * 3600)
        photoUrlByItem.set(r.id, url)
      } catch {
        // Photo unreachable — renderer just hides the <img>.
      }
    }),
  )

  const services = itemRows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    durationMin: r.isBookable ? (r.bookingDurationMin ?? fallbackSlot ?? 30) : 0,
    price: priceByItem.get(r.id) ?? '0',
    isBookable: r.isBookable,
    category: r.category,
    imageUrl: photoUrlByItem.get(r.id) ?? null,
  }))

  const activeResources = await db
    .select({
      id: bookingResources.id,
      name: bookingResources.name,
      kind: bookingResources.kind,
      isPaused: bookingResources.isPaused,
    })
    .from(bookingResources)
    .where(and(eq(bookingResources.tenantId, tenantId), eq(bookingResources.isActive, true)))
    .orderBy(asc(bookingResources.name))

  const resourceIds = activeResources.map((r) => r.id)
  const queueRows =
    resourceIds.length > 0
      ? await db
          .select({
            resourceId: bookings.resourceId,
            ticketNumber: bookings.ticketNumber,
            publicName: bookings.publicName,
            status: bookings.status,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              inArray(bookings.resourceId, resourceIds),
              sql`${bookings.status} IN ('pending', 'confirmed', 'in_progress')`,
            ),
          )
          .orderBy(asc(bookings.createdAt))
      : []

  // ─── Promos + stamp programs for the editor preview ──────────────
  // Mirrors public-tenant.ts so the editor preview shows the same data
  // the live site will render. Kept compact — see public-tenant.ts for
  // the longer comments on the discount-label and reward-label
  // pre-build rationale.
  const now = new Date()
  const promoRows = await db
    .select({
      id: tenantPromotions.id,
      name: tenantPromotions.name,
      code: tenantPromotions.code,
      triggerType: tenantPromotions.triggerType,
      discountType: tenantPromotions.discountType,
      discountValue: tenantPromotions.discountValue,
      maxDiscountAmount: tenantPromotions.maxDiscountAmount,
      startsAt: tenantPromotions.startsAt,
      endsAt: tenantPromotions.endsAt,
      imageKey: tenantPromotions.imageKey,
    })
    .from(tenantPromotions)
    .where(
      and(
        eq(tenantPromotions.tenantId, tenantId),
        eq(tenantPromotions.isActive, true),
        or(
          isNull(tenantPromotions.startsAt),
          lte(tenantPromotions.startsAt, now),
        ),
      ),
    )
    .orderBy(asc(tenantPromotions.createdAt))

  const promoImageUrlById = new Map<string, string>()
  await Promise.all(
    promoRows
      .filter((p) => !!p.imageKey)
      .map(async (p) => {
        try {
          const url = await getPromoImageSignedUrl(
            p.imageKey as string,
            7 * 24 * 3600,
          )
          promoImageUrlById.set(p.id, url)
        } catch {
          // image gone — preview omits the <img>
        }
      }),
  )

  const promos = promoRows.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    triggerType: p.triggerType as
      | 'code'
      | 'auto_product'
      | 'auto_products'
      | 'auto_category'
      | 'auto_cart',
    discountLabel:
      p.discountType === 'percent'
        ? `${Number(p.discountValue).toLocaleString('id-ID')}%${
            p.maxDiscountAmount
              ? ` (maks. ${formatRupiah(Number(p.maxDiscountAmount))})`
              : ''
          }`
        : formatRupiah(Number(p.discountValue)),
    validityLabel: p.endsAt
      ? `Berlaku s/d ${new Date(p.endsAt).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}`
      : null,
    // productName retired — multi-target promos can't surface a single
    // product on the storefront; the promo's `name` already describes
    // scope.
    productName: null as string | null,
    imageUrl: promoImageUrlById.get(p.id) ?? null,
  }))

  const stampRows = await db
    .select({
      id: loyaltyStampPrograms.id,
      name: loyaltyStampPrograms.name,
      stampsRequired: loyaltyStampPrograms.stampsRequired,
      rewardMode: loyaltyStampPrograms.rewardMode,
      rewardItemName: inventoryItems.name,
      imageKey: loyaltyStampPrograms.imageKey,
    })
    .from(loyaltyStampPrograms)
    .leftJoin(
      inventoryItems,
      eq(inventoryItems.id, loyaltyStampPrograms.rewardItemId),
    )
    .where(
      and(
        eq(loyaltyStampPrograms.tenantId, tenantId),
        eq(loyaltyStampPrograms.isActive, true),
      ),
    )
    .orderBy(asc(loyaltyStampPrograms.createdAt))

  const stampIds = stampRows.map((r) => r.id)
  const bundleRows = stampIds.length
    ? await db
        .select({
          programId: loyaltyStampProgramRewards.programId,
          itemName: inventoryItems.name,
          quantity: loyaltyStampProgramRewards.quantity,
        })
        .from(loyaltyStampProgramRewards)
        .innerJoin(
          inventoryItems,
          eq(inventoryItems.id, loyaltyStampProgramRewards.itemId),
        )
        .where(inArray(loyaltyStampProgramRewards.programId, stampIds))
        .orderBy(
          asc(loyaltyStampProgramRewards.sortOrder),
          asc(loyaltyStampProgramRewards.createdAt),
        )
    : []
  const bundleByProgram = new Map<
    string,
    Array<{ itemName: string; quantity: number }>
  >()
  for (const b of bundleRows) {
    const list = bundleByProgram.get(b.programId) ?? []
    list.push({ itemName: b.itemName, quantity: b.quantity })
    bundleByProgram.set(b.programId, list)
  }

  const stampImageUrlById = new Map<string, string>()
  await Promise.all(
    stampRows
      .filter((r) => !!r.imageKey)
      .map(async (r) => {
        try {
          const url = await getStampImageSignedUrl(
            r.imageKey as string,
            7 * 24 * 3600,
          )
          stampImageUrlById.set(r.id, url)
        } catch {
          // image gone
        }
      }),
  )

  const stampPrograms = stampRows.map((r) => ({
    id: r.id,
    name: r.name,
    stampsRequired: r.stampsRequired,
    rewardLabel:
      r.rewardMode === 'bundle'
        ? (bundleByProgram.get(r.id) ?? [])
            .map((b) => `${b.quantity}× ${b.itemName}`)
            .join(' + ') || '—'
        : (r.rewardItemName ?? '—'),
    imageUrl: stampImageUrlById.get(r.id) ?? null,
  }))

  return {
    tenant: {
      businessName: tenant?.businessName ?? '',
      publicSlug: tenant?.publicSlug ?? null,
    },
    mode: bsettings?.mode ?? null,
    branches: tenantBranches,
    services,
    resources: activeResources,
    queue: queueRows.map((row) => ({
      resourceId: row.resourceId,
      ticketNumber: row.ticketNumber,
      firstName: row.publicName?.split(' ')[0] ?? null,
      status: row.status,
    })),
    tax: taxSummary,
    promos,
    stampPrograms,
  }
})
