import { db } from '@vintra/db'
import {
  tenants,
  attendanceSettings,
  inventorySettings,
  posSettings,
  waSettings,
  tenantMembers,
} from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'
import type { InventoryTierKey, POSTierKey } from '@vintra/shared'
import { posTierLimits } from '@vintra/shared'
import { requireAuth, requirePermission, type AuthContext } from './auth'

/**
 * Ensures the caller's tenant has the given module activated
 * (present in `tenants.activeModules`). Use on every server function
 * that belongs to a paid module.
 *
 * For paid modules with time-limited subscriptions (currently just
 * `attendance`), this also verifies the subscription is active AND
 * `subscriptionExpiresAt` is in the future. Throws `ModuleNotActive`
 * when either check fails — callers should surface this as a
 * "subscribe/renew" CTA in the UI.
 */
export async function requireActiveModule(
  moduleKey: string,
): Promise<AuthContext> {
  const auth = await requireAuth()

  const [tenant] = await db
    .select({ activeModules: tenants.activeModules })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)

  if (!tenant?.activeModules.includes(moduleKey)) {
    throw new Error('ModuleNotActive')
  }

  // Paid module — verify EITHER the subscription hasn't expired OR
  // the tenant is mid-trial. Trial + paid are orthogonal states: both
  // can be set simultaneously (admin converting trial → paid); either
  // being valid grants access. Generalise this lookup into a per-module
  // settings-table registry when a second paid module ships.
  if (moduleKey === 'attendance') {
    const [settings] = await db
      .select({
        subscriptionActive: attendanceSettings.subscriptionActive,
        subscriptionExpiresAt: attendanceSettings.subscriptionExpiresAt,
        trialEndsAt: attendanceSettings.trialEndsAt,
      })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, auth.tenantId))
      .limit(1)

    const now = Date.now()
    const paidExpiresAt = settings?.subscriptionExpiresAt
      ? new Date(settings.subscriptionExpiresAt).getTime()
      : 0
    const paidOk = !!settings?.subscriptionActive && paidExpiresAt > now
    const trialEndsAt = settings?.trialEndsAt
      ? new Date(settings.trialEndsAt).getTime()
      : 0
    const trialOk = trialEndsAt > now

    if (!paidOk && !trialOk) {
      throw new Error('ModuleNotActive')
    }
  }

  return auth
}

/**
 * POS access resolver — same shape as `requireInventoryAccess`. Free
 * is always accessible; paid + trial coexist orthogonally; expiry
 * drops back to free without locking the tenant out (they keep their
 * sales history and the cashier flow, just hit the 50/day cap).
 *
 * Server functions branch on `posTier` for feature gating without
 * re-querying the settings row.
 */
export interface POSAccessContext extends AuthContext {
  posTier: POSTierKey
}

export async function requirePOSAccess(): Promise<POSAccessContext> {
  const auth = await requireAuth()

  const [settings] = await db
    .select({
      tier: posSettings.tier,
      subscriptionActive: posSettings.subscriptionActive,
      subscriptionExpiresAt: posSettings.subscriptionExpiresAt,
      trialEndsAt: posSettings.trialEndsAt,
    })
    .from(posSettings)
    .where(eq(posSettings.tenantId, auth.tenantId))
    .limit(1)

  if (!settings) {
    // First access — seed the row so the tenant has a stable home for
    // their POS state. Idempotent because tenant_id is unique.
    await db
      .insert(posSettings)
      .values({ tenantId: auth.tenantId, tier: 'free' })
      .onConflictDoNothing({ target: posSettings.tenantId })
    return { ...auth, posTier: 'free' }
  }

  const now = Date.now()
  const paidExpiresAt = settings.subscriptionExpiresAt
    ? new Date(settings.subscriptionExpiresAt).getTime()
    : 0
  const paidOk = settings.subscriptionActive && paidExpiresAt > now
  const trialEndsAt = settings.trialEndsAt
    ? new Date(settings.trialEndsAt).getTime()
    : 0
  const trialOk = trialEndsAt > now

  let effectiveTier: POSTierKey
  if (paidOk) {
    effectiveTier = settings.tier as POSTierKey
  } else if (trialOk) {
    effectiveTier = 'toko'
  } else {
    effectiveTier = 'free'
  }

  return { ...auth, posTier: effectiveTier }
}

/**
 * JUR-176: assert the tenant has the `tenant_site` feature flag (currently
 * Komplit-only). Used by every Situs editor + analytics server fn and by
 * the public renderer to dark-out the site on downgrade.
 *
 * Returns the POS access context so callers can also check the
 * `posTier` (e.g. for tier-specific copy in error messages). Throws with
 * a clear upgrade prompt when the feature isn't available.
 */
export async function requireTenantSiteAccess(): Promise<POSAccessContext> {
  const auth = await requirePOSAccess()
  if (!posTierLimits(auth.posTier).features.includes('tenant_site')) {
    throw new Error(
      'Fitur Situs hanya tersedia di paket Komplit. Upgrade untuk aktifkan.',
    )
  }
  return auth
}

/**
 * Non-throwing variant used by the public renderer. Returns the tier
 * for the tenant the caller looked up by slug (no auth context).
 * Returns `null` if the tier doesn't have `tenant_site` — caller
 * treats that as "no published site" and 404s.
 */
export async function getTenantSiteAccessForTenantId(
  tenantId: string,
): Promise<{ posTier: POSTierKey; hasTenantSite: boolean } | null> {
  const [row] = await db
    .select({
      tier: posSettings.tier,
      subscriptionActive: posSettings.subscriptionActive,
      subscriptionExpiresAt: posSettings.subscriptionExpiresAt,
      trialEndsAt: posSettings.trialEndsAt,
    })
    .from(posSettings)
    .where(eq(posSettings.tenantId, tenantId))
    .limit(1)

  if (!row) return { posTier: 'free', hasTenantSite: false }

  const now = Date.now()
  const paidExpiresAt = row.subscriptionExpiresAt
    ? new Date(row.subscriptionExpiresAt).getTime()
    : 0
  const paidOk = row.subscriptionActive && paidExpiresAt > now
  const trialOk = row.trialEndsAt
    ? new Date(row.trialEndsAt).getTime() > now
    : false

  let posTier: POSTierKey
  if (paidOk) posTier = row.tier as POSTierKey
  else if (trialOk) posTier = 'toko'
  else posTier = 'free'

  const hasTenantSite = posTierLimits(posTier).features.includes('tenant_site')
  return { posTier, hasTenantSite }
}

/**
 * JUR-155: Cashflow Monitoring gate. Bundled into Komplit via the
 * `cashflow` POS feature flag. Also requires `pos.read` — cashflow is a
 * financial surface, so a cashier (who only holds `pos.transact`) must
 * not reach it even inside a Komplit tenant.
 *
 * Returns the POS access context so callers can branch on `posTier`.
 */
export async function requireCashflowAccess(): Promise<POSAccessContext> {
  const auth = await requirePOSAccess()
  if (!posTierLimits(auth.posTier).features.includes('cashflow')) {
    throw new Error(
      'Fitur Cashflow hanya tersedia di paket Komplit. Upgrade untuk aktifkan.',
    )
  }
  if (!auth.permissions.includes('pos.read')) {
    throw new Error('Forbidden')
  }
  return auth
}

/**
 * Non-throwing Cashflow check for ledger postings made from other
 * modules (e.g. PO payments). Keyed on the tenant's plan only — the
 * acting member doesn't need Cashflow access for the books to stay in
 * sync.
 */
export async function tenantHasCashflow(tenantId: string): Promise<boolean> {
  const access = await getTenantSiteAccessForTenantId(tenantId)
  return !!access && posTierLimits(access.posTier).features.includes('cashflow')
}

export interface InventoryAccessContext extends AuthContext {
  inventoryTier: InventoryTierKey
}

export async function requireInventoryAccess(): Promise<InventoryAccessContext> {
  const auth = await requireAuth()

  const [settings] = await db
    .select({
      tier: inventorySettings.tier,
      subscriptionActive: inventorySettings.subscriptionActive,
      subscriptionExpiresAt: inventorySettings.subscriptionExpiresAt,
      trialEndsAt: inventorySettings.trialEndsAt,
    })
    .from(inventorySettings)
    .where(eq(inventorySettings.tenantId, auth.tenantId))
    .limit(1)

  if (!settings) {
    // First access — seed the row so the tenant has a stable home for
    // their inventory state. Idempotent because tenant_id is unique.
    await db
      .insert(inventorySettings)
      .values({ tenantId: auth.tenantId, tier: 'free' })
      .onConflictDoNothing({ target: inventorySettings.tenantId })
    return { ...auth, inventoryTier: 'free' }
  }

  const now = Date.now()
  const paidExpiresAt = settings.subscriptionExpiresAt
    ? new Date(settings.subscriptionExpiresAt).getTime()
    : 0
  const paidOk = settings.subscriptionActive && paidExpiresAt > now
  const trialEndsAt = settings.trialEndsAt
    ? new Date(settings.trialEndsAt).getTime()
    : 0
  const trialOk = trialEndsAt > now

  let effectiveTier: InventoryTierKey
  if (paidOk) {
    effectiveTier = settings.tier as InventoryTierKey
  } else if (trialOk) {
    effectiveTier = 'toko'
  } else {
    effectiveTier = 'free'
  }

  return { ...auth, inventoryTier: effectiveTier }
}

/**
 * WhatsApp access — view-only gate (JUR-84).
 *
 * Two-layer check:
 *   1. Permission: caller's role must include `whatsapp.read` (granted to
 *      owner/admin/supervisor by default; staff/cashier never see WA).
 *   2. Tier resolution: returns the effective wa_settings tier so server
 *      functions can branch on Basic / Komplit / Enterprise features
 *      without re-querying. No row → 'free' (the wa_settings row is
 *      created lazily by the subscription flow, not by this read path).
 *
 * Mirrors `requirePOSAccess` for tier handling; differs in that it
 * gates on a permission first instead of silently allowing every tenant
 * member through.
 */
export type WATierKey = 'free' | 'basic' | 'komplit' | 'enterprise'

export interface WAAccessContext extends AuthContext {
  waTier: WATierKey
}

async function resolveWATier(tenantId: string): Promise<WATierKey> {
  const [settings] = await db
    .select({
      tier: waSettings.tier,
      subscriptionActive: waSettings.subscriptionActive,
      subscriptionExpiresAt: waSettings.subscriptionExpiresAt,
      trialEndsAt: waSettings.trialEndsAt,
    })
    .from(waSettings)
    .where(eq(waSettings.tenantId, tenantId))
    .limit(1)

  if (!settings) return 'free'

  const now = Date.now()
  const paidExpiresAt = settings.subscriptionExpiresAt
    ? new Date(settings.subscriptionExpiresAt).getTime()
    : 0
  const paidOk = settings.subscriptionActive && paidExpiresAt > now
  const trialEndsAt = settings.trialEndsAt
    ? new Date(settings.trialEndsAt).getTime()
    : 0
  const trialOk = trialEndsAt > now

  if (paidOk) return settings.tier as WATierKey
  if (trialOk) return 'basic'
  return 'free'
}

export async function requireWAAccess(): Promise<WAAccessContext> {
  const auth = await requirePermission('whatsapp.read')
  const waTier = await resolveWATier(auth.tenantId)
  return { ...auth, waTier }
}

/**
 * WhatsApp manage gate — for write operations (create/delete/pair
 * instance, change AI settings, edit RAG tools). Stricter than
 * `requireWAAccess`: requires `whatsapp.manage`, which only owner +
 * admin get by default. Supervisors can read chats but not reconfigure
 * the integration.
 */
export async function requireWAManageAccess(): Promise<WAAccessContext> {
  const auth = await requirePermission('whatsapp.manage')
  const waTier = await resolveWATier(auth.tenantId)
  return { ...auth, waTier }
}

/**
 * Gate for Vintra AI.
 *
 * Bundled into the existing `komplit` tier rather than given a tier of its
 * own: Vintra sells a single Rp 149.000 package, so stacking another price
 * level above it would work against that — and no tenant is paying for the
 * first level yet.
 *
 * Two gates, not one. The tier decides whether the business has the feature;
 * `tenant_members.ai_enabled` decides which staff may use it, because the
 * assistant can read sales, cashflow and margins — figures an owner may not
 * want every cashier seeing. Owners always pass.
 */
export async function requireBusinessAiAccess(): Promise<POSAccessContext> {
  const auth = await requirePOSAccess()
  if (!posTierLimits(auth.posTier).features.includes('business_ai')) {
    throw new Error(
      'Vintra AI hanya tersedia di paket Komplit. Upgrade untuk mengaktifkan.',
    )
  }
  if (auth.roleKey !== 'owner') {
    const [member] = await db
      .select({ aiEnabled: tenantMembers.aiEnabled })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, auth.tenantId),
          eq(tenantMembers.userId, auth.userId),
        ),
      )
      .limit(1)
    if (!member?.aiEnabled) {
      throw new Error('Akses Vintra AI belum diaktifkan oleh pemilik usaha.')
    }
  }
  return auth
}
