/**
 * JUR-185: public tenant surfaces for `<slug>.vintra.my.id`.
 *
 * Two server fns:
 *   - claimPublicSlug — authenticated tenant action, gated on booking.write
 *   - getPublicQueueData — NO AUTH, scoped read for the public queue page
 *
 * Lives in its own file to keep the public-surface boundary obvious
 * during code review (anything in here ships data to anonymous visitors).
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  tenants,
  tenantSites,
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
import { and, eq, sql, asc, inArray, ne, or, lte, isNull } from 'drizzle-orm'
import {
  getTenantSiteAssetSignedUrl,
  getInventoryPhotoSignedUrl,
  getPromoImageSignedUrl,
  getStampImageSignedUrl,
} from '@/lib/s3-storage'
import { formatRupiah } from '@/lib/currency'
import { normalizeSettingsV2 } from '@/lib/site-templates/sections-v2/normalize'
import { collectImageKeysV2 } from '@/lib/site-templates/sections-v2/registry'
import {
  recordSiteView,
  getClientIpFromHeaders,
} from '@/server/lib/record-site-view'
import { requirePermission } from '../middleware/auth'
import { getTenantSiteAccessForTenantId } from '../middleware/module-access'

// ─── Slug claim ─────────────────────────────────────────────────────

/**
 * Reserved subdomains — tenants can't claim these. Buckets:
 *   - System / infra: matches nginx vhosts we already use OR are likely to add
 *   - Auth / dashboard routes that mustn't collide with the SaaS app
 *   - Static-asset prefixes that CDN providers commonly use
 *   - Marketing surfaces we'd rather host ourselves
 *   - Vintra brand terms
 *   - All current authed module paths (so a tenant can't claim "pos" and
 *     confuse customers about which `pos.vintra.my.id` is real)
 */
const RESERVED_SLUGS = new Set([
  // System / infra
  'admin', 'api', 'app', 'www', 'mail', 'smtp', 'pop', 'pop3', 'imap',
  'ftp', 'sftp', 'ssh', 'webmail', 'ns', 'ns1', 'ns2', 'ns3', 'ns4',
  'dns', 'mx', 'cpanel', 'whm',
  // Auth / dashboard
  'auth', 'login', 'logout', 'signin', 'signout', 'signup', 'register',
  'dashboard', 'account', 'profile', 'me', 'settings',
  // Static / CDN
  'static', 'assets', 'cdn', 'files', 'media', 'images', 'img', 'video',
  'css', 'js', 'fonts', 'public', 'private',
  // Marketing / docs
  'about', 'blog', 'help', 'docs', 'support', 'status', 'contact',
  'pricing', 'terms', 'privacy', 'legal', 'careers', 'jobs', 'press',
  // SaaS module paths (avoids tenant subdomain colliding with our app routes)
  'pos', 'hpp', 'inventory', 'booking', 'attendance', 'finance',
  'whatsapp', 'wa', 'master', 'notifications', 'referrals',
  // Brand
  'vintra',
  // Common test / placeholder names
  'test', 'dev', 'staging', 'prod', 'demo', 'sandbox', 'beta', 'alpha',
  'preview', 'localhost', 'example', 'null', 'undefined', 'root', 'home',
])

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

export const claimPublicSlug = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ slug: z.string().trim().toLowerCase() }))
  .handler(async ({ data }) => {
    // Tenant-level vanity slug — used as the situs subdomain (Komplit)
    // AND as a friendly alias on the staff WA-login URL (every tier).
    // No situs-feature gate so non-Komplit tenants can still claim a
    // memorable login URL for their staff. settings.manage = owner-only.
    const { tenantId } = await requirePermission('settings.manage')

    const slug = data.slug
    if (!SLUG_REGEX.test(slug)) {
      throw new Error(
        'URL hanya boleh huruf kecil, angka, dan tanda hubung (3–30 karakter). Tidak boleh diawali / diakhiri tanda hubung.',
      )
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new Error(`"${slug}" sudah dipesan sistem. Pilih URL lain.`)
    }

    // Uniqueness check across OTHER tenants (partial unique index also
    // enforces this — the explicit check just gives a friendlier message).
    const [taken] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.publicSlug, slug), ne(tenants.id, tenantId)))
      .limit(1)
    if (taken) {
      throw new Error(`URL "${slug}" sudah dipakai usaha lain. Pilih URL lain.`)
    }

    const [updated] = await db
      .update(tenants)
      .set({ publicSlug: slug, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ publicSlug: tenants.publicSlug })

    return { slug: updated?.publicSlug ?? slug }
  })

// ─── JUR-185: Host-aware index route data ────────────────────────────

/**
 * Reads the Host header server-side, parses out a tenant subdomain, and
 * returns the data the `/` index route needs to decide what to render:
 *   - `kind: 'landing'`   → apex (vintra.my.id) or dev (localhost)
 *   - `kind: 'queue'`     → a claimed tenant subdomain — render queue page
 *   - `kind: 'notfound'`  → a syntactically-valid subdomain that nobody claimed
 *
 * Wrapped in a server fn (not done inline in the loader) because
 * `getRequest()` only exists in the server bundle. The createServerFn
 * macro strips the handler body from the client bundle so the index
 * route file stays safely importable in both contexts.
 */
export const getIndexRouteHostData = createServerFn().handler(async () => {
  let host: string | null = null
  try {
    host = getRequest().headers.get('host')
  } catch {
    host = null
  }
  if (!host) return { kind: 'landing' as const }

  const hostname = host.split(':')[0]!.toLowerCase()
  const match = hostname.match(
    /^([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\.vintra\.my\.id$/,
  )
  if (!match) return { kind: 'landing' as const }
  const slug = match[1]!
  // www and api never reach the queue lookup. www is just the apex
  // with a prefix; api has its own vhost so won't normally reach this
  // code, but guard anyway in case of dev/test misconfiguration.
  if (slug === 'www' || slug === 'api') return { kind: 'landing' as const }

  // Inline the same lookup as `getPublicQueueData` so the index route
  // can fetch everything in one server roundtrip during SSR.
  // JUR-189: a claimed tenant subdomain must never render a raw 500.
  // If the data fetch fails (DB hiccup, asset signing, etc.) fall
  // back to a branded "sedang gangguan" page instead of bubbling the
  // error into the SSR render path.
  let queue: Awaited<ReturnType<typeof fetchPublicQueueDataForSlug>>
  try {
    queue = await fetchPublicQueueDataForSlug(slug)
  } catch (err) {
    console.error(`[public-site] data fetch failed for "${slug}":`, err)
    return { kind: 'error' as const, slug }
  }
  if (!queue) return { kind: 'notfound' as const, slug }

  // JUR-177: published tenant pages are edge-cached by Cloudflare for
  // 5 min (publish / maintenance toggles fire an active purge so the
  // TTL is just a backstop). Unpublished + maintenance pages have
  // `indexable=false` and stay uncached so edits show instantly.
  if (queue.seo.indexable) {
    try {
      setResponseHeader(
        'cache-control',
        'public, s-maxage=300, stale-while-revalidate=600',
      )
    } catch {
      // No response context (dev / tests) — skip silently.
    }
  }

  // Track this page view. SSR-only entry point so we know it's a
  // real visit (not a 15s poll). `recordSiteView` is fire-and-forget
  // — it never throws back into the render path.
  try {
    const req = getRequest()
    const headers = req.headers
    await recordSiteView({
      tenantId: queue._tenantId,
      slug,
      path: '/',
      ip: getClientIpFromHeaders(headers),
      referrer: headers.get('referer'),
    })
  } catch {
    // No request context (dev / tests) — skip tracking silently.
  }

  return { kind: 'queue' as const, slug, data: stripPrivateFields(queue) }
})

// ─── Public queue page data ──────────────────────────────────────────

/**
 * No-auth scoped read for the public queue page. Returns ONLY public-
 * safe fields:
 *   - tenant business name + slug (no tenant id, no owner id, no plan)
 *   - branches: name + address + business_hours + lat/long (the Maps
 *     section pins each branch — a storefront location is public info)
 *   - bookable services: name + price + color + duration
 *   - queue snapshot: ticket number + first-name-only + status
 *     (no phone numbers, no customer ids, no notes, no resource ids)
 *
 * Returns null when no tenant matches the slug — caller renders 404.
 * Never throws an authorization error; this is anonymous-callable.
 */
export const getPublicQueueData = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      slug: z.string().trim().toLowerCase(),
      /**
       * Loader / initial-load callers pass true so the request gets
       * recorded as a view. The 15s polling client omits it (default
       * false) so the dashboard doesn't see one human as 5760 visits.
       */
      track: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await fetchPublicQueueDataForSlug(data.slug)
    if (!result) return null

    if (data.track) {
      try {
        const req = getRequest()
        const headers = req.headers
        await recordSiteView({
          tenantId: result._tenantId,
          slug: data.slug,
          path: `/q/${data.slug}`,
          ip: getClientIpFromHeaders(headers),
          referrer: headers.get('referer'),
        })
      } catch {
        // No request context — skip silently.
      }
    }

    return stripPrivateFields(result)
  })

/**
 * Shared lookup body. Both `getPublicQueueData` (the public-facing
 * server fn called by the polling client) and `getIndexRouteHostData`
 * (the SSR-only Host-aware loader) call into this so the queue
 * snapshot shape stays consistent between paths.
 */
async function fetchPublicQueueDataForSlug(slug: string) {
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

  // JUR-176: dark out the public site when the tenant doesn't have
  // an active `tenant_site` feature flag (currently Komplit-only).
  // Treat downgrade exactly like an un-claimed slug — the public URL
  // 404s. Prevents the "subscribe, publish, cancel, keep using" loop.
  const access = await getTenantSiteAccessForTenantId(tenant.id)
  if (!access?.hasTenantSite) return null

  // JUR-176: read the published site row (if any). Anonymous visitors
  // see `published_*` snapshots — NEVER the editable `settings` draft.
  // If the tenant has no published row, callers fall back to the
  // baseline JUR-185 queue page renderer.
  const [site] = await db
    .select({
      publishedTemplateId: tenantSites.publishedTemplateId,
      publishedSettings: tenantSites.publishedSettings,
      maintenanceMode: tenantSites.maintenanceMode,
      maintenanceMessage: tenantSites.maintenanceMessage,
    })
    .from(tenantSites)
    .where(eq(tenantSites.tenantId, tenant.id))
    .limit(1)

  // JUR-176 follow-up: maintenance mode short-circuits everything.
  // No queue, no services, no analytics tracking — just the
  // maintenance marker so the renderer can show the offline page.
  // We pull the brand color from published_settings if present (so
  // the maintenance page still looks branded) but skip every other
  // join since none of that data is used.
  if (site?.maintenanceMode) {
    let brandColor = '#2563EB'
    if (site.publishedSettings && typeof site.publishedSettings === 'object') {
      const theme = (site.publishedSettings as Record<string, unknown>).theme
      if (theme && typeof theme === 'object') {
        const bc = (theme as Record<string, unknown>).brandColor
        if (typeof bc === 'string' && /^#[0-9a-fA-F]{6}$/.test(bc)) {
          brandColor = bc
        }
      }
    }
    return {
      _tenantId: tenant.id,
      tenant: {
        businessName: tenant.businessName,
        publicSlug: tenant.publicSlug,
      },
      maintenance: {
        active: true as const,
        message: site.maintenanceMessage,
        brandColor,
      },
      // SEO block — a site in maintenance must never be indexed.
      seo: {
        title: tenant.businessName,
        description: null as string | null,
        ogImageUrl: null as string | null,
        firstHeroImageUrl: null as string | null,
        indexable: false,
      },
      // Stubs — kept so the response shape matches the non-maintenance
      // path closely enough that callers don't need a separate type.
      mode: null,
      branches: [],
      services: [],
      resources: [],
      queue: [],
      tax: { totalPercent: 0, labels: [] as string[] },
      promos: [] as Array<never>,
      stampPrograms: [] as Array<never>,
      site: null,
    }
  }

  const [settings] = await db
    .select({ mode: bookingSettings.mode, slotDurationMin: bookingSettings.slotDurationMin })
    .from(bookingSettings)
    .where(eq(bookingSettings.tenantId, tenant.id))
    .limit(1)

  // Tax stack — drives the "harga belum termasuk pajak" footnote on
  // the Services section. Sum every active row; show the labels so
  // tenants with stacked taxes (PPN + PB1) get specific copy.
  const [pos] = await db
    .select({ taxes: posSettings.taxes })
    .from(posSettings)
    .where(eq(posSettings.tenantId, tenant.id))
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
    .where(and(eq(branches.tenantId, tenant.id), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt))
  // `numeric` columns arrive as strings — coerce to numbers for the
  // Maps section.
  const tenantBranches = branchRows.map((b) => ({
    ...b,
    latitude: Number(b.latitude),
    longitude: Number(b.longitude),
  }))

  // Pricing pulled separately and merged in JS — Drizzle's `${col}`
  // inside a correlated-subquery `sql` template stops generating the
  // outer-query reference correctly (the SELECT comes back with
  // price '0' for every row, even though the data is there). Two
  // queries is also one less moving piece to debug later.
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
        eq(inventoryItems.tenantId, tenant.id),
        eq(inventoryItems.isSellable, true),
        eq(inventoryItems.isActive, true),
        // JUR-176 follow-up: dropped the `is_bookable=true` filter.
        // The public site lists everything the tenant sells, not just
        // bookable services — e.g. a cuci motor wants its instant-
        // noodle SKUs visible alongside the wash service so waiting
        // customers can see what's on the snack rack.
        // Hide items whose category opted out of situs (Bungkus etc.);
        // uncategorized items pass since the LEFT JOIN yields NULL.
        or(
          isNull(inventoryItems.categoryId),
          eq(tenantCategories.isVisibleOnSitus, true),
        ),
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
            minQty: inventoryItemUnitPricing.minQty,
            sortOrder: inventoryItemUnitPricing.sortOrder,
          })
          .from(inventoryItemUnitPricing)
          .where(inArray(inventoryItemUnitPricing.itemId, itemIds))
          .orderBy(
            asc(inventoryItemUnitPricing.minQty),
            asc(inventoryItemUnitPricing.sortOrder),
          )
      : []

  // First row per itemId wins — the orderBy guarantees the cheapest
  // tier comes first.
  const priceByItem = new Map<string, string>()
  for (const row of pricingRows) {
    if (!priceByItem.has(row.itemId)) {
      priceByItem.set(row.itemId, row.unitPrice)
    }
  }

  const fallbackSlot = settings?.slotDurationMin ?? null

  // Pre-sign every item photo in one parallel batch. 7-day TTL — the
  // public page is heavily edge-cached, so a short-lived signature
  // would expire before the cache rotates. If a tenant updates a
  // photo, the new URL appears on the next publish (cache purge).
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
        // Photo deleted or unreachable — renderer will just omit the <img>.
      }
    }),
  )

  const services = itemRows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    // Non-bookable items get `0` here. The renderer hides the
    // duration badge unless `isBookable && durationMin > 0`.
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
    .where(
      and(eq(bookingResources.tenantId, tenant.id), eq(bookingResources.isActive, true)),
    )
    .orderBy(asc(bookingResources.name))

  const resourceIds = activeResources.map((r) => r.id)
  const queueRows =
    resourceIds.length > 0
      ? await db
          .select({
            id: bookings.id,
            resourceId: bookings.resourceId,
            ticketNumber: bookings.ticketNumber,
            publicName: bookings.publicName,
            status: bookings.status,
            createdAt: bookings.createdAt,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenant.id),
              inArray(bookings.resourceId, resourceIds),
              sql`${bookings.status} IN ('pending', 'confirmed', 'in_progress')`,
            ),
          )
          .orderBy(asc(bookings.createdAt))
      : []

  // Strip last name + lastname-initial reveal for privacy. Customers
  // checking the public page don't need the full name of who's
  // currently being served — first name is plenty for them to
  // identify themselves. ("Budi" + ticket number is unambiguous.)
  const queue = queueRows.map((row) => ({
    resourceId: row.resourceId,
    ticketNumber: row.ticketNumber,
    firstName: row.publicName?.split(' ')[0] ?? null,
    status: row.status,
  }))

  // ─── Promos + stamp programs (public-safe) ────────────────────────
  // Promos that the Promo situs section can render. We expose ONLY
  // safe-to-display fields (no caps, no per-customer limits) plus the
  // image url (if any) and a pre-built discount label so the renderer
  // doesn't have to discriminate by discountType. We DON'T hide
  // expired promos here — the section has a per-page `hideExpired`
  // toggle so the tenant can choose to keep an archive visible.
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
        eq(tenantPromotions.tenantId, tenant.id),
        eq(tenantPromotions.isActive, true),
        // Already-started OR no start date.
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
          // Image gone — renderer just omits it.
        }
      }),
  )

  const promos = promoRows.map((p) => {
    const discountLabel =
      p.discountType === 'percent'
        ? `${Number(p.discountValue).toLocaleString('id-ID')}%${
            p.maxDiscountAmount
              ? ` (maks. ${formatRupiah(Number(p.maxDiscountAmount))})`
              : ''
          }`
        : formatRupiah(Number(p.discountValue))
    const validityLabel = p.endsAt
      ? `Berlaku s/d ${new Date(p.endsAt).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}`
      : null
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      triggerType: p.triggerType as
        | 'code'
        | 'auto_product'
        | 'auto_products'
        | 'auto_category'
        | 'auto_cart',
      discountLabel,
      validityLabel,
      // productName retired — multi-target promos can't surface a
      // single product on the storefront; the promo's `name` already
      // describes scope ("Promo Coklat", "Diskon Akhir Pekan").
      productName: null as string | null,
      imageUrl: promoImageUrlById.get(p.id) ?? null,
    }
  })

  // Stamp programs — active rows only, with reward summary pre-built.
  const stampRows = await db
    .select({
      id: loyaltyStampPrograms.id,
      name: loyaltyStampPrograms.name,
      stampsRequired: loyaltyStampPrograms.stampsRequired,
      rewardMode: loyaltyStampPrograms.rewardMode,
      rewardItemId: loyaltyStampPrograms.rewardItemId,
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
        eq(loyaltyStampPrograms.tenantId, tenant.id),
        eq(loyaltyStampPrograms.isActive, true),
      ),
    )
    .orderBy(asc(loyaltyStampPrograms.createdAt))

  const stampProgramIds = stampRows.map((r) => r.id)
  const bundleRows = stampProgramIds.length
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
        .where(inArray(loyaltyStampProgramRewards.programId, stampProgramIds))
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
          // Image gone — renderer omits it.
        }
      }),
  )

  const stampPrograms = stampRows.map((r) => {
    const rewardLabel =
      r.rewardMode === 'bundle'
        ? (bundleByProgram.get(r.id) ?? [])
            .map((b) => `${b.quantity}× ${b.itemName}`)
            .join(' + ') || '—'
        : (r.rewardItemName ?? '—')
    return {
      id: r.id,
      name: r.name,
      stampsRequired: r.stampsRequired,
      rewardLabel,
      imageUrl: stampImageUrlById.get(r.id) ?? null,
    }
  })

  // JUR-176 v2: normalize the published settings into the v2 shape
  // and collect every image key across all sections (including
  // gallery repeater items). Tenants on old v1 settings get a
  // best-effort conversion on the fly; the next save persists v2.
  const v2Settings = site?.publishedSettings
    ? normalizeSettingsV2(site.publishedSettings)
    : null

  const assetUrls: Record<string, string> = {}
  if (v2Settings) {
    const keys = collectImageKeysV2(v2Settings)
    await Promise.all(
      keys.map(async (k) => {
        try {
          assetUrls[k] = await getTenantSiteAssetSignedUrl(k)
        } catch {
          // Asset deleted out from under us — just skip; the
          // renderer will omit the <img> tag.
        }
      }),
    )
  }

  // SEO block (JUR-177). `seo` rides inside v2Settings; surface it at
  // the top level so the index route's `head()` can build the meta
  // tags without digging into the settings tree. `ogImageAssetKey`
  // isn't a section image so it's signed separately here.
  // `indexable` = published (v2Settings present) — an unpublished but
  // claimed slug renders but must carry robots=noindex.
  let ogImageUrl: string | null = null
  const ogKey = v2Settings?.seo?.ogImageAssetKey
  if (ogKey) {
    try {
      ogImageUrl = await getTenantSiteAssetSignedUrl(ogKey)
    } catch {
      // Asset gone — fall back to no OG image.
    }
  }
  // First hero-image asset key — used by the SSR <head> to emit a
  // <link rel="preload" as="image" fetchpriority="high">. Without
  // this, the browser can't start fetching the hero until it parses
  // the body and finds the <img> tag, costing 200–600ms of LCP.
  const firstHeroKey = findFirstHeroAssetKey(v2Settings)
  const firstHeroImageUrl = firstHeroKey
    ? (assetUrls[firstHeroKey] ?? null)
    : null

  const seo = {
    title: (v2Settings?.seo?.title ?? '').trim() || tenant.businessName,
    description: ((v2Settings?.seo?.description ?? '').trim() || null) as
      | string
      | null,
    ogImageUrl,
    firstHeroImageUrl,
    indexable: !!v2Settings,
  }

  return {
    // Server-private — used by recordSiteView callers, MUST be
    // stripped before returning to anonymous visitors. Both surface
    // server fns (getPublicQueueData + getIndexRouteHostData) do
    // that stripping explicitly below.
    _tenantId: tenant.id,
    tenant: {
      businessName: tenant.businessName,
      publicSlug: tenant.publicSlug,
    },
    mode: settings?.mode ?? null,
    seo,
    branches: tenantBranches,
    services,
    resources: activeResources,
    queue,
    tax: taxSummary,
    promos,
    stampPrograms,
    // Null on the normal path; the maintenance branch above sets
    // this to a truthy object that the renderer detects + paints.
    maintenance: null as
      | null
      | { active: true; message: string | null; brandColor: string },
    // V2 published site. `settings` is null when the tenant hasn't
    // published yet — the renderer falls back to the JUR-185
    // baseline queue page in that case.
    site: v2Settings
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          settings: v2Settings as any,
          assetUrls,
        }
      : null,
  }
}

/**
 * First hero image asset key, used to preload the LCP image in the
 * SSR <head>. Picks the first enabled hero section, then its first
 * image entry (v2 `heroImages[].imageAssetKey`, falling back to the
 * legacy single `heroImageAssetKey`). Returns null when no hero
 * section, no enabled hero, or no images.
 */
function findFirstHeroAssetKey(
  v2: ReturnType<typeof normalizeSettingsV2> | null,
): string | null {
  if (!v2) return null
  const hero = v2.sections.find((s) => s.type === 'hero' && s.enabled)
  if (!hero) return null
  const settings = hero.settings as Record<string, unknown>
  const arr = settings.heroImages
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const k = (item as Record<string, unknown>).imageAssetKey
        if (typeof k === 'string' && k.length > 0) return k
      }
    }
  }
  const legacy = settings.heroImageAssetKey
  if (typeof legacy === 'string' && legacy.length > 0) return legacy
  return null
}

/**
 * Strips the `_tenantId` server-private field before returning data
 * to anonymous visitors. Both surface server fns funnel through this.
 */
function stripPrivateFields<T extends { _tenantId?: string }>(
  raw: T,
): Omit<T, '_tenantId'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _tenantId, ...rest } = raw
  return rest
}
