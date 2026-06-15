import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { getAppOrigin } from '../lib/app-url'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/session-cookies'
import { z } from 'zod'
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  setPasswordSchema,
  posTierLimits,
  coerceStorablePhone,
} from '@vintra/shared'
import { attributeReferralIfPresent } from '../lib/referral-attribute'
import { db } from '@vintra/db'
import {
  tenants,
  tenantMembers,
  tenantCategories,
  roles,
  permissions as permissionsTable,
  rolePermissions,
  platformAdmins,
  activeImpersonations,
  attendanceSettings,
  inventorySettings,
  posSettings,
  waSettings,
  tenantReferralSettings,
} from '@vintra/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth, resolveRoleAndPermissions } from '../middleware/auth'
import { refreshSessionCoalesced } from '../lib/refresh-session'
import {
  sendEmail,
  buildSignupVerificationEmail,
  buildPasswordResetEmail,
} from '../email'

async function getOwnerRoleId(): Promise<string | null> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, 'owner'))
    .limit(1)
  return row?.id ?? null
}

function getSupabaseServer() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}

function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '')
  }
  const cookies = request.headers.get('cookie') ?? ''
  const match = cookies.match(/sb-access-token=([^;]+)/)
  return match?.[1] ?? null
}

function extractRefreshToken(request: Request): string | null {
  const cookies = request.headers.get('cookie') ?? ''
  const match = cookies.match(/sb-refresh-token=([^;]+)/)
  return match?.[1] ?? null
}

/** Mirrors writeTokenCookies in middleware/auth.ts. Kept as a sibling
 * here so getCurrentUser can also extend the sliding session — that
 * fn is hit by every authed page load, so it's the most common path
 * where a server-side refresh happens before the browser refresh. */
function writeTokenCookies(accessToken: string, refreshToken: string) {
  const isHttps = (process.env.VITE_APP_URL ?? '').startsWith('https://')
  const opts = {
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax' as const,
    secure: isHttps,
    httpOnly: false,
  }
  setCookie(ACCESS_TOKEN_COOKIE, accessToken, opts)
  setCookie(REFRESH_TOKEN_COOKIE, refreshToken, opts)
}

export const getCurrentUser = createServerFn().handler(async () => {
  const request = getRequest()
  const token = extractToken(request)

  if (!token) {
    return null
  }

  const supabase = getSupabaseServer()

  // Try validating the access token
  let { data: { user }, error } = await supabase.auth.getUser(token)

  // If access token is expired, try refreshing with the refresh token.
  // Writing the new pair back as cookies extends the sliding session
  // window — see writeTokenCookies above for the full rationale.
  if (error && extractRefreshToken(request)) {
    const refreshToken = extractRefreshToken(request)!
    const { data: refreshData, error: refreshError } =
      await refreshSessionCoalesced(supabase, refreshToken)

    if (!refreshError && refreshData.session && refreshData.user) {
      user = refreshData.user
      writeTokenCookies(
        refreshData.session.access_token,
        refreshData.session.refresh_token,
      )
    }
  }

  if (!user) {
    return null
  }

  // Get tenant info
  const membership = await db
    .select({
      tenantId: tenantMembers.tenantId,
      role: tenantMembers.role,
      roleId: tenantMembers.roleId,
    })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1)

  let tenantInfo = null
  if (membership.length > 0) {
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, membership[0]!.tenantId))
      .limit(1)
    tenantInfo = tenant[0] ?? null
  } else {
    const ownedTenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.ownerId, user.id))
      .limit(1)
    tenantInfo = ownedTenant[0] ?? null
  }

  // Check for impersonation: if this user is a platform admin AND has an active
  // impersonation row, replace tenantInfo and resolve owner permissions for that tenant.
  const [admin] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, user.id))
    .limit(1)
  let impersonating = false
  let impersonatedTenantName: string | undefined
  if (admin) {
    const [impersonation] = await db
      .select()
      .from(activeImpersonations)
      .where(eq(activeImpersonations.adminUserId, user.id))
      .limit(1)
    if (impersonation) {
      const [impTenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, impersonation.tenantId))
        .limit(1)
      if (impTenant) {
        tenantInfo = impTenant
        impersonating = true
        impersonatedTenantName = impTenant.businessName
      }
    }
  }

  // Resolve permissions from the user's role (or owner role if impersonating)
  let userPermissions: string[] = []
  let resolvedRoleKey: string | null = null
  if (impersonating) {
    const [ownerRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'owner'))
      .limit(1)
    if (ownerRole) {
      resolvedRoleKey = 'owner'
      const perms = await db
        .select({ key: permissionsTable.key })
        .from(rolePermissions)
        .innerJoin(
          permissionsTable,
          eq(rolePermissions.permissionId, permissionsTable.id),
        )
        .where(eq(rolePermissions.roleId, ownerRole.id))
      userPermissions = perms.map((p) => p.key)
    }
  } else {
    // Prefer roleId when set; fall back to looking up by role text (legacy
    // rows where role_id FK was never populated still need working perms).
    let effectiveRoleId = membership[0]?.roleId ?? null
    if (!effectiveRoleId && membership[0]?.role) {
      const [fallbackRole] = await db
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(eq(roles.key, membership[0].role))
        .limit(1)
      if (fallbackRole) {
        effectiveRoleId = fallbackRole.id
        resolvedRoleKey = fallbackRole.key
      }
    }

    if (effectiveRoleId) {
      if (!resolvedRoleKey) {
        const [roleRow] = await db
          .select({ key: roles.key })
          .from(roles)
          .where(eq(roles.id, effectiveRoleId))
          .limit(1)
        resolvedRoleKey = roleRow?.key ?? null
      }

      const perms = await db
        .select({ key: permissionsTable.key })
        .from(rolePermissions)
        .innerJoin(
          permissionsTable,
          eq(rolePermissions.permissionId, permissionsTable.id),
        )
        .where(eq(rolePermissions.roleId, effectiveRoleId))
      userPermissions = perms.map((p) => p.key)
    }
  }

  // Fall back to tenant member's profile name for invited users who
  // don't have user_metadata.full_name set (e.g., created via Supabase
  // invite). Name now lives on tenant_members.{firstName,lastName}.
  let displayName = user.user_metadata?.full_name as string | undefined
  if (!displayName && tenantInfo?.id) {
    const [memberProfile] = await db
      .select({
        firstName: tenantMembers.firstName,
        lastName: tenantMembers.lastName,
      })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.userId, user.id),
          eq(tenantMembers.tenantId, tenantInfo.id),
        ),
      )
      .limit(1)
    const composed = [memberProfile?.firstName, memberProfile?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (composed) displayName = composed
  }

  // Attendance module: enrich the tenant context with live subscription
  // status so route guards can check "active AND not expired" without
  // hitting the DB on every navigation. Only populated when the module
  // appears in activeModules.
  let moduleSubscriptions: {
    attendance?: {
      active: boolean
      expiresAt: string | null
      isExpired: boolean
      trialActive: boolean
      trialEndsAt: string | null
      trialUsed: boolean
    }
    inventory?: {
      tier: 'free' | 'toko' | 'bisnis' | 'multi_outlet'
      active: boolean
      expiresAt: string | null
      isExpired: boolean
      trialActive: boolean
      trialEndsAt: string | null
      trialUsed: boolean
    }
    pos?: {
      tier: 'free' | 'toko' | 'bisnis' | 'multi_outlet'
      active: boolean
      expiresAt: string | null
      isExpired: boolean
      trialActive: boolean
      trialEndsAt: string | null
      trialUsed: boolean
      features: ReadonlyArray<string>
    }
    whatsapp?: {
      tier: string
      active: boolean
      expiresAt: string | null
    }
  } = {}
  // Always query attendance_settings (not gated on activeModules) so the
  // client can tell a brand-new tenant (trialUsed=false → can still try)
  // apart from a tenant who's already consumed their trial. Route guards
  // still use `active`/`trialActive`; those are false for never-subscribed
  // tenants, so gating behaviour is unchanged.
  if (tenantInfo?.id) {
    const [settings] = await db
      .select({
        subscriptionActive: attendanceSettings.subscriptionActive,
        subscriptionExpiresAt: attendanceSettings.subscriptionExpiresAt,
        trialEndsAt: attendanceSettings.trialEndsAt,
        trialUsed: attendanceSettings.trialUsed,
      })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.tenantId, tenantInfo.id))
      .limit(1)
    const expiresAt = settings?.subscriptionExpiresAt
      ? new Date(settings.subscriptionExpiresAt)
      : null
    const isExpired = !expiresAt || expiresAt.getTime() <= Date.now()
    const trialEndsAt = settings?.trialEndsAt
      ? new Date(settings.trialEndsAt)
      : null
    const trialActive = !!trialEndsAt && trialEndsAt.getTime() > Date.now()
    moduleSubscriptions.attendance = {
      active: settings?.subscriptionActive ?? false,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      isExpired,
      trialActive,
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
      trialUsed: settings?.trialUsed ?? false,
    }

    // Inventory subscription state — same shape, plus the resolved
    // tier so the sidebar / pages can read tier directly without
    // recomputing from the timestamps.
    const [invSettings] = await db
      .select({
        tier: inventorySettings.tier,
        subscriptionActive: inventorySettings.subscriptionActive,
        subscriptionExpiresAt: inventorySettings.subscriptionExpiresAt,
        trialEndsAt: inventorySettings.trialEndsAt,
        trialUsed: inventorySettings.trialUsed,
      })
      .from(inventorySettings)
      .where(eq(inventorySettings.tenantId, tenantInfo.id))
      .limit(1)
    const invExpiresAt = invSettings?.subscriptionExpiresAt
      ? new Date(invSettings.subscriptionExpiresAt)
      : null
    const invIsExpired =
      !invExpiresAt || invExpiresAt.getTime() <= Date.now()
    const invTrialEndsAt = invSettings?.trialEndsAt
      ? new Date(invSettings.trialEndsAt)
      : null
    const invTrialActive =
      !!invTrialEndsAt && invTrialEndsAt.getTime() > Date.now()
    moduleSubscriptions.inventory = {
      tier: (invSettings?.tier ?? 'free') as
        | 'free'
        | 'toko'
        | 'bisnis'
        | 'multi_outlet',
      active: invSettings?.subscriptionActive ?? false,
      expiresAt: invExpiresAt ? invExpiresAt.toISOString() : null,
      isExpired: invIsExpired,
      trialActive: invTrialActive,
      trialEndsAt: invTrialEndsAt ? invTrialEndsAt.toISOString() : null,
      trialUsed: invSettings?.trialUsed ?? false,
    }

    // POS subscription state — same shape as inventory, plus the
    // resolved tier so the sidebar / pages can read tier directly.
    const [posStg] = await db
      .select({
        tier: posSettings.tier,
        subscriptionActive: posSettings.subscriptionActive,
        subscriptionExpiresAt: posSettings.subscriptionExpiresAt,
        trialEndsAt: posSettings.trialEndsAt,
        trialUsed: posSettings.trialUsed,
      })
      .from(posSettings)
      .where(eq(posSettings.tenantId, tenantInfo.id))
      .limit(1)
    const posExpiresAt = posStg?.subscriptionExpiresAt
      ? new Date(posStg.subscriptionExpiresAt)
      : null
    const posIsExpired = !posExpiresAt || posExpiresAt.getTime() <= Date.now()
    const posTrialEndsAt = posStg?.trialEndsAt
      ? new Date(posStg.trialEndsAt)
      : null
    const posTrialActive =
      !!posTrialEndsAt && posTrialEndsAt.getTime() > Date.now()
    // Resolve effective tier — same logic as `requirePOSAccess`. If
    // paid is active+unexpired use the persisted tier; if trial is
    // active treat as 'toko'; otherwise 'free'. Features are then
    // derived from the effective tier so the client can feature-gate
    // (e.g., sidebar shows the Pelanggan link only when customer_db
    // is included).
    const posPaidOk =
      !!(posStg?.subscriptionActive) && !posIsExpired
    const posEffectiveTier: 'free' | 'toko' | 'bisnis' | 'multi_outlet' | 'komplit' = posPaidOk
      ? ((posStg!.tier ?? 'free') as 'free' | 'toko' | 'bisnis' | 'multi_outlet' | 'komplit')
      : posTrialActive
        ? 'toko'
        : 'free'
    const posLimits = posTierLimits(posEffectiveTier)

    moduleSubscriptions.pos = {
      tier: posEffectiveTier as
        | 'free'
        | 'toko'
        | 'bisnis'
        | 'multi_outlet',
      active: posStg?.subscriptionActive ?? false,
      expiresAt: posExpiresAt ? posExpiresAt.toISOString() : null,
      isExpired: posIsExpired,
      trialActive: posTrialActive,
      trialEndsAt: posTrialEndsAt ? posTrialEndsAt.toISOString() : null,
      trialUsed: posStg?.trialUsed ?? false,
      features: posLimits.features,
    }

    // WhatsApp subscription state — read from wa_settings.
    const [waSub] = await db
      .select({
        tier: waSettings.tier,
        subscriptionActive: waSettings.subscriptionActive,
        subscriptionExpiresAt: waSettings.subscriptionExpiresAt,
      })
      .from(waSettings)
      .where(eq(waSettings.tenantId, tenantInfo.id))
      .limit(1)
    const waExpiresAt = waSub?.subscriptionExpiresAt
      ? new Date(waSub.subscriptionExpiresAt)
      : null
    const waActive = !!(waSub?.subscriptionActive) && (!waExpiresAt || waExpiresAt.getTime() > Date.now())
    moduleSubscriptions.whatsapp = {
      tier: waSub?.tier ?? 'free',
      active: waActive,
      expiresAt: waExpiresAt ? waExpiresAt.toISOString() : null,
    }
  }

  // Referral allowlist: the tenant can RUN a referral program (create
  // codes, view pendaftar, claim commissions) only when it has an
  // enabled `tenant_referral_settings` row. Drives the sidebar entry
  // visibility + the /referrals route guard. Being *referred* is not
  // gated by this flag.
  let referralAccess = false
  if (tenantInfo?.id) {
    const [refRow] = await db
      .select({ enabled: tenantReferralSettings.enabled })
      .from(tenantReferralSettings)
      .where(eq(tenantReferralSettings.tenantId, tenantInfo.id))
      .limit(1)
    referralAccess = refRow?.enabled === true
  }

  // Surface the user's linked auth providers so the client can render
  // the right account-management UI: change-password vs. set-password.
  const identities = user.identities ?? []
  const authProviders = {
    email: identities.some((i) => i.provider === 'email'),
    google: identities.some((i) => i.provider === 'google'),
  }

  return {
    id: user.id,
    email: user.email!,
    fullName: displayName,
    tenant: tenantInfo,
    moduleSubscriptions,
    referralAccess,
    role: impersonating ? 'owner' : (membership[0]?.role ?? 'owner'),
    roleKey: resolvedRoleKey ?? membership[0]?.role ?? 'owner',
    permissions: userPermissions,
    authProviders,
    impersonating,
    impersonatedTenantName,
  }
})

/**
 * Resolve the current Supabase user from the request's session token,
 * falling back to refreshing if the access token has expired. Returns
 * null when no valid session is found. Mirrors the resolution flow in
 * `getCurrentUser` so password endpoints share the same auth contract.
 */
async function resolveSessionUser() {
  const request = getRequest()
  const token = extractToken(request)
  if (!token) return null

  const supabase = getSupabaseServer()
  let { data: { user }, error } = await supabase.auth.getUser(token)

  if (error && extractRefreshToken(request)) {
    const refreshToken = extractRefreshToken(request)!
    const { data: refreshData, error: refreshError } =
      await refreshSessionCoalesced(supabase, refreshToken)
    if (!refreshError && refreshData.user) {
      user = refreshData.user
    }
  }

  return user ?? null
}

export const changePassword = createServerFn({ method: 'POST' })
  .inputValidator(changePasswordSchema)
  .handler(async ({ data }) => {
    const user = await resolveSessionUser()
    if (!user || !user.email) {
      throw new Error('Unauthorized')
    }

    // Reject if this user doesn't actually have an email/password
    // identity — they should be using setPassword instead.
    const hasEmailIdentity = (user.identities ?? []).some(
      (i) => i.provider === 'email',
    )
    if (!hasEmailIdentity) {
      throw new Error(
        'Akun ini belum memiliki password. Gunakan menu "Buat Password".',
      )
    }

    // Verify the current password by attempting a fresh sign-in on a
    // throwaway server client. The new tokens this returns are not
    // persisted anywhere — the user's existing browser session is
    // unaffected. Supabase rate-limits this endpoint, which protects
    // against brute-force guessing.
    const verifier = getSupabaseServer()
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: data.currentPassword,
    })
    if (verifyError) {
      throw new Error('Password saat ini salah')
    }

    const admin = getSupabaseServer()
    const { error: updateError } = await admin.auth.admin.updateUserById(
      user.id,
      { password: data.newPassword },
    )
    if (updateError) {
      throw new Error(updateError.message)
    }

    return { ok: true }
  })

export const setPassword = createServerFn({ method: 'POST' })
  .inputValidator(setPasswordSchema)
  .handler(async ({ data }) => {
    const user = await resolveSessionUser()
    if (!user || !user.email) {
      throw new Error('Unauthorized')
    }

    // Reject if this user already has an email/password identity —
    // they should be using changePassword instead, which verifies the
    // existing password first.
    const hasEmailIdentity = (user.identities ?? []).some(
      (i) => i.provider === 'email',
    )
    if (hasEmailIdentity) {
      throw new Error(
        'Akun ini sudah memiliki password. Gunakan menu "Ubah Password".',
      )
    }

    // Passing `email` alongside `password` is what causes Supabase to
    // create the email identity for users who only have a Google one.
    // Without `email` here, the password update silently no-ops for
    // OAuth-only accounts.
    const admin = getSupabaseServer()
    const { error: updateError } = await admin.auth.admin.updateUserById(
      user.id,
      { password: data.newPassword, email: user.email },
    )
    if (updateError) {
      throw new Error(updateError.message)
    }

    return { ok: true }
  })

export const loginWithEmail = createServerFn({ method: 'POST' })
  .inputValidator(loginSchema)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServer()
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })

    if (error) {
      throw new Error(error.message === 'Invalid login credentials'
        ? 'Email atau password salah'
        : error.message)
    }

    return {
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      user: {
        id: authData.user.id,
        email: authData.user.email!,
      },
    }
  })

/**
 * Look up which auth providers are linked to an email. Used by the login
 * page after a failed password attempt so we can tell Google-SSO-only
 * users to use the Google button instead of staring at "Invalid
 * credentials" (they don't have a password — they CAN'T succeed here).
 *
 * Returns `null` when the email isn't found OR when the user has at
 * least one email-based credential — in both cases the generic "invalid
 * credentials" message is the right thing to show.
 *
 * Security note: this is a mild user-enumeration vector (attacker can
 * learn "this email signed up with Google"). We accept it because
 * (a) it only fires AFTER a failed password attempt — at that point the
 * attacker already knows the email is plausible enough to try, and
 * (b) the alternative (silent generic error) traps real users in a
 * loop. The UX cost outweighs the enumeration cost for this app.
 */
export const checkLoginAuthMethod = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    // Drizzle's schemaFilter is 'public' only, so we hit auth.users
    // via raw SQL through the same postgres connection — same trick
    // registerWithEmail uses for its existence pre-check.
    // raw_app_meta_data->providers is the array Supabase keeps in sync
    // with the linked identity rows; we read it directly instead of
    // round-tripping through admin.listUsers (which doesn't support
    // exact-email filtering and would force a scan).
    const rows = await db.execute<{ providers: string[] | null }>(
      sql`SELECT raw_app_meta_data->'providers' AS providers
            FROM auth.users
           WHERE lower(email) = lower(${data.email})
           LIMIT 1`,
    )
    const row = rows[0]
    if (!row) return { googleOnly: false }

    const providers = (row.providers ?? []).map((p) => p.toLowerCase())
    const googleOnly =
      providers.length > 0 && providers.every((p) => p === 'google')

    return { googleOnly }
  })

/**
 * Send a password reset email via Brevo (not via Supabase's hosted SMTP).
 *
 * Same rationale as registerWithEmail's switch to admin.generateLink +
 * Brevo: Supabase's mailer has been rate-limited in this project. We
 * own a Brevo integration with branded templates — use it.
 *
 * Flow:
 *   1. admin.generateLink({ type: 'recovery' }) returns the same action
 *      URL Supabase would have emailed (no email is sent by Supabase).
 *   2. We deliver that URL via Brevo with our branded template.
 *   3. User clicks the link → Supabase establishes a recovery session →
 *      lands them on /auth/reset-password which already handles the
 *      updateUser({ password }) call.
 *
 * Anti-enumeration: we always return `{ ok: true }` regardless of
 * whether the email exists. The user is told "if the email is
 * registered, you'll get a reset link". This matches Supabase's own
 * default behavior.
 */
export const sendPasswordResetEmail = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const supabase = getSupabaseServer()
    const appUrl = getAppOrigin()
    const redirectTo = `${appUrl}/auth/reset-password`

    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: data.email,
        options: { redirectTo },
      })

    if (linkError) {
      // "user not found" / unconfirmed accounts: silently no-op to
      // avoid leaking which emails are registered.
      const msg = (linkError.message ?? '').toLowerCase()
      if (msg.includes('not found') || msg.includes('user_not_found')) {
        return { ok: true }
      }
      console.error('[sendPasswordResetEmail] generateLink failed:', linkError)
      return { ok: true }
    }

    const actionLink = linkData.properties?.action_link
    if (!actionLink) return { ok: true }

    const tpl = buildPasswordResetEmail({ actionLink })
    await sendEmail({
      to: data.email,
      subject: tpl.subject,
      htmlContent: tpl.htmlContent,
      textContent: tpl.textContent,
      tag: 'password-reset',
    })

    return { ok: true }
  })

export const registerWithEmail = createServerFn({ method: 'POST' })
  .inputValidator(registerSchema)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServer()
    const appUrl = getAppOrigin()
    const callbackUrl = `${appUrl}/auth/callback`

    // Pre-check: bail loudly if `auth.users` already has this email.
    //
    // Why this is necessary: when Supabase's `admin.generateLink({ type:
    // 'signup', email, password })` is called for an email that already
    // has a row (e.g. an old invite-flow user, or a partial signup that
    // never got cleaned up), it does NOT throw. It silently re-issues a
    // verification link AND DOES NOT update the password. That left at
    // least one user (mkhamzah@umkmall.id, see commit history) in a
    // state where the new password they typed during signup was never
    // persisted; after clicking the link they'd be stuck unable to log
    // in because the stored hash was still the old one.
    //
    // Drizzle's schemaFilter is 'public' only, so we hit auth.users via
    // raw SQL through the same postgres connection.
    const existing = await db.execute<{ exists: number }>(
      sql`SELECT 1 AS exists FROM auth.users WHERE lower(email) = lower(${data.email}) LIMIT 1`,
    )
    if (existing.length > 0) {
      throw new Error('Email sudah terdaftar')
    }

    // We deliver the signup verification email through our own Brevo
    // pipeline instead of via supabase.auth.signUp(). Supabase's
    // hosted SMTP is rate-limited (the bug "Error sending
    // confirmation email" surfaces from there once the budget is
    // exceeded) and we already own a Brevo integration with branded
    // templates for every other transactional message — so we route
    // signup through the same path.
    //
    // Flow:
    //   1. admin.generateLink({ type: 'signup' }) creates the user
    //      record (unconfirmed, NO email sent by Supabase) and
    //      returns properties.action_link — the same URL Supabase
    //      would have emailed.
    //   2. We send that link via our Brevo helper.
    //   3. User clicks the link → Supabase verifies the email and
    //      redirects them to /auth/callback, which already runs
    //      ensureTenantForOAuth() (idempotent) and lands them on the
    //      dashboard.
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: 'signup',
        email: data.email,
        password: data.password,
        options: {
          data: { full_name: data.fullName },
          redirectTo: callbackUrl,
        },
      })

    if (linkError) {
      const msg = (linkError.message ?? '').toLowerCase()
      if (
        msg.includes('already') ||
        msg.includes('duplicate') ||
        (linkError as { code?: string }).code === 'email_exists'
      ) {
        throw new Error('Email sudah terdaftar')
      }
      throw new Error(linkError.message)
    }

    const userId = linkData.user?.id
    const actionLink = linkData.properties?.action_link
    if (!userId || !actionLink) {
      throw new Error('Gagal membuat akun')
    }

    // Deliver the verification email. If Brevo fails (rate limit,
    // network, bad API key), undo the Supabase user creation so the
    // user can retry signup with the same email — without rollback
    // they'd be stuck on "Email sudah terdaftar" without ever having
    // received a confirmation.
    const tpl = buildSignupVerificationEmail({
      fullName: data.fullName,
      actionLink,
    })
    const sent = await sendEmail({
      to: data.email,
      toName: data.fullName,
      subject: tpl.subject,
      htmlContent: tpl.htmlContent,
      textContent: tpl.textContent,
      tag: 'signup-verification',
    })

    if (!sent) {
      await supabase.auth.admin.deleteUser(userId).catch((err) => {
        console.error(
          '[register] failed to rollback unconfirmed user',
          userId,
          err,
        )
      })
      throw new Error(
        'Gagal mengirim email verifikasi. Silakan coba beberapa saat lagi.',
      )
    }

    // Idempotency: if this user already owns a tenant, skip the
    // create steps entirely and just return needsVerification. A
    // double-click / accidental re-submit (or a Brevo retry that
    // fires registerWithEmail twice) used to insert a SECOND tenant
    // for the same owner — which then bit us via the
    // requireAuth random-pick bug. The UNIQUE constraint on
    // tenants.owner_id (migration 0069+) would block it at the DB
    // level too, but checking first lets us return a clean response
    // instead of the user seeing a UNIQUE-violation error.
    const existingTenant = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerId, userId))
      .limit(1)

    if (existingTenant.length > 0) {
      return {
        accessToken: null,
        refreshToken: null,
        user: { id: userId, email: data.email },
        needsVerification: true,
        needsLogin: false,
      }
    }

    // Create slug from business name
    const slug = data.businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()

    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        businessName: data.businessName,
        slug: `${slug}-${Date.now().toString(36)}`,
        ownerId: userId,
      })
      .returning()

    // Add owner as tenant member
    const ownerRoleId = await getOwnerRoleId()
    // JUR-124: split the registered full name into first/last so the
    // owner row in /settings/members doesn't display "(belum diisi)".
    // First space wins; everything after goes to lastName so multi-word
    // surnames stay together. Trims defensively in case the form sent
    // padded whitespace.
    const trimmedName = data.fullName.trim()
    const firstSpace = trimmedName.indexOf(' ')
    const firstName =
      firstSpace === -1 ? trimmedName : trimmedName.slice(0, firstSpace)
    const lastName =
      firstSpace === -1 ? null : trimmedName.slice(firstSpace + 1).trim() || null
    await db.insert(tenantMembers).values({
      tenantId: tenant!.id,
      userId,
      role: 'owner',
      roleId: ownerRoleId,
      firstName,
      lastName,
    })

    // Seed default categories
    await db.insert(tenantCategories).values([
      { tenantId: tenant!.id, name: 'Makanan', sortOrder: 1 },
      { tenantId: tenant!.id, name: 'Minuman', sortOrder: 2 },
      { tenantId: tenant!.id, name: 'Snack', sortOrder: 3 },
    ])

    // JUR-91: write the referral attribution if the user signed up
    // with a code. Best-effort — invalid/inactive/self-referral all
    // silently no-op so a bad code never blocks signup.
    await attributeReferralIfPresent({
      newTenantId: tenant!.id,
      rawCode: data.referralCode,
    })

    return {
      accessToken: null,
      refreshToken: null,
      user: { id: userId, email: data.email },
      needsVerification: true,
      needsLogin: false,
    }
  })

export const ensureTenantForOAuth = createServerFn({ method: 'POST' })
  // JUR-91: optional referral code passed from /auth/callback after it
  // reads the jq_ref cookie. The fn keeps the no-arg call site working
  // (legacy uses) since the field is optional.
  .inputValidator(
    z
      .object({ referralCode: z.string().optional() })
      .optional()
      .default({}),
  )
  .handler(async ({ data }) => {
    const request = getRequest()
    const token = extractToken(request)

    if (!token) {
      throw new Error('Unauthorized')
    }

    const supabase = getSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser(token)

    if (!user) {
      throw new Error('Unauthorized')
    }

    // Check if user already has a tenant
    const existingMembership = await db
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id))
      .limit(1)

    if (existingMembership.length > 0) {
      return { created: false }
    }

    const existingOwned = await db
      .select()
      .from(tenants)
      .where(eq(tenants.ownerId, user.id))
      .limit(1)

    if (existingOwned.length > 0) {
      return { created: false }
    }

    // Create tenant using user's name or email
    const displayName =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      user.email?.split('@')[0] ||
      'Usaha Saya'

    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()

    // Race-safe insert: the SELECT-then-INSERT above is logically
    // checked, but two concurrent OAuth callbacks (e.g. the user
    // reloads the post-OAuth redirect) both find 0 rows and both
    // try to INSERT. With the UNIQUE(tenants.owner_id) constraint
    // from migration 0069+, the second insert raises a unique
    // violation — catching it cleanly and returning `{ created:
    // false }` matches the "tenant already exists" semantics the
    // caller expects, instead of bubbling a 500 to the OAuth
    // landing page.
    let tenant: { id: string } | undefined
    try {
      const inserted = await db
        .insert(tenants)
        .values({
          businessName: `Usaha ${displayName}`,
          slug: `${slug}-${Date.now().toString(36)}`,
          ownerId: user.id,
        })
        .returning({ id: tenants.id })
      tenant = inserted[0]
    } catch (err) {
      // Postgres unique violation = 23505. drizzle-orm surfaces the
      // PG code via the `cause` chain depending on driver; the most
      // portable check is the message string.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('tenants_owner_id_key') || msg.includes('23505')) {
        return { created: false }
      }
      throw err
    }
    if (!tenant) return { created: false }

    const ownerRoleIdOAuth = await getOwnerRoleId()
    await db.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
      roleId: ownerRoleIdOAuth,
    })

    // Seed default categories
    await db.insert(tenantCategories).values([
      { tenantId: tenant.id, name: 'Makanan', sortOrder: 1 },
      { tenantId: tenant.id, name: 'Minuman', sortOrder: 2 },
      { tenantId: tenant.id, name: 'Snack', sortOrder: 3 },
    ])

    // JUR-91: attribute the referral if a code was carried through the
    // OAuth flow. Same best-effort semantics as the email signup path.
    await attributeReferralIfPresent({
      newTenantId: tenant.id,
      rawCode: data?.referralCode,
    })

    return { created: true }
  })

export const completeOnboarding = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      businessName: z.string().min(1),
      businessCategory: z.string().min(1),
      employeeRange: z.string().min(1),
      // Phone lives on tenant_members (owner's contact), not tenants —
      // it's a person attribute, and tenant_members.phone already
      // exists. min(8) covers the shortest valid Indonesian formats
      // (e.g., 081 + 7 digits); max(20) tolerates +62 prefixes and
      // separators users sometimes type.
      phone: z
        .string()
        .min(8, 'Nomor HP tidak valid')
        .max(20, 'Nomor HP tidak valid'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()
    await db
      .update(tenants)
      .set({
        businessName: data.businessName,
        businessCategory: data.businessCategory,
        employeeRange: data.employeeRange,
        onboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
    await db
      .update(tenantMembers)
      .set({ phone: coerceStorablePhone(data.phone) })
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.userId, userId),
        ),
      )
    return { success: true }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  // Client-side will clear the tokens
  return { success: true }
})

/**
 * Returns every tenant the current user has access to — both ones
 * they own and ones they're a member of. Drives the mobile app's
 * tenant-picker screen (when a user has more than one tenant, they
 * pick which to scope subsequent requests to via X-Tenant-Id header).
 *
 * On web today most users have exactly one tenant (one-tenant-per-
 * owner enforced by migration 0069), so this returns a single-item
 * array in the common case. Sales/admin users can be members of
 * multiple — that's the case the mobile picker exists for.
 *
 * Returns empty array when not authed (rather than throwing) so the
 * mobile app can call this without a try/catch on the very first
 * load before session restore completes.
 */
export const listMyTenants = createServerFn().handler(async () => {
  const request = getRequest()
  const token = extractToken(request)
  if (!token) return []

  const supabase = getSupabaseServer()
  const { data: userResult } = await supabase.auth.getUser(token)
  const user = userResult.user
  if (!user) return []

  // Tenants the user owns — synthesize role='owner'.
  const owned = await db
    .select({
      id: tenants.id,
      businessName: tenants.businessName,
      slug: tenants.publicSlug,
    })
    .from(tenants)
    .where(eq(tenants.ownerId, user.id))

  // Tenants the user is a member of — surface the membership role +
  // role_id so we can resolve the granted permission keys.
  const memberOf = await db
    .select({
      id: tenants.id,
      businessName: tenants.businessName,
      slug: tenants.publicSlug,
      role: tenantMembers.role,
      roleId: tenantMembers.roleId,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(eq(tenantMembers.userId, user.id))

  // Owned wins for ownership claim — a tenant can appear as both
  // (legacy rows where the owner also got a member row).
  const ownedIds = new Set(owned.map((t) => t.id))

  // The mobile app gates home-screen widgets (and other role-aware UI)
  // off these permission keys, so each tenant summary carries the
  // resolved set. Owners get the full owner-role bundle (resolved once);
  // members resolve from their assigned role. Usually one tenant per
  // user, so the per-member resolve loop is cheap.
  const ownerPermissions =
    owned.length > 0
      ? (await resolveRoleAndPermissions({ roleKey: 'owner' })).permissions
      : []

  const memberSummaries = await Promise.all(
    memberOf
      .filter((t) => !ownedIds.has(t.id))
      .map(async (t) => {
        const resolved = await resolveRoleAndPermissions({
          roleId: t.roleId,
          roleKey: t.role,
        })
        return {
          id: t.id,
          businessName: t.businessName,
          slug: t.slug,
          role: t.role,
          roleKey: resolved.roleKey ?? t.role,
          permissions: resolved.permissions,
        }
      }),
  )

  const merged = [
    ...owned.map((t) => ({
      ...t,
      role: 'owner' as const,
      roleKey: 'owner',
      permissions: ownerPermissions,
    })),
    ...memberSummaries,
  ]

  return merged
})
