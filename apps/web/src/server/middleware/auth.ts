import { createClient } from '@supabase/supabase-js'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { db } from '@vintra/db'
import { startScheduler } from '../scheduler'
import { refreshSessionCoalesced } from '../lib/refresh-session'
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/session-cookies'

// Boot the in-process notification scheduler on first import. This
// module is loaded by every authenticated request (requireAuth lives
// here), so the scheduler is guaranteed to start on the first request
// after a process boot. The globalThis guard inside startScheduler()
// makes repeat imports / HMR reloads a no-op.
startScheduler()
import {
  tenants,
  tenantMembers,
  tenantMemberBranches,
  roles,
  permissions as permissionsTable,
  rolePermissions,
  platformAdmins,
  activeImpersonations,
} from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'

function getSupabaseServer() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}

function extractToken(request: Request): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '')
  }

  // Try cookie
  const cookies = request.headers.get('cookie') ?? ''
  const match = cookies.match(/sb-access-token=([^;]+)/)
  return match?.[1] ?? null
}

function extractRefreshToken(request: Request): string | null {
  const cookies = request.headers.get('cookie') ?? ''
  const match = cookies.match(/sb-refresh-token=([^;]+)/)
  return match?.[1] ?? null
}

/**
 * Optional X-Tenant-Id header — used by the mobile app to scope a
 * request to a specific tenant when the user belongs to multiple.
 * Web ignores this (browser never sends it) and falls back to the
 * historical "oldest membership" behavior. Membership is verified
 * before the header is honored — a forged header for someone else's
 * tenant is rejected the same as an unauth'd request.
 */
function extractRequestedTenantId(request: Request): string | null {
  const header = request.headers.get('x-tenant-id')
  if (!header) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(header)) {
    return null
  }
  return header.toLowerCase()
}

/**
 * Write the freshly-minted access + refresh tokens onto the response
 * after a successful server-side `refreshSession()`. Without this the
 * cookies stay frozen at the version that landed on login, so:
 *   - the cookie max-age countdown never resets (sliding session
 *     wouldn't actually slide for SSR-only traffic),
 *   - and any setup that re-enables refresh-token rotation in the
 *     Supabase dashboard would invalidate the cookie immediately.
 *
 * We use TanStack Start's `setCookie` so the Set-Cookie header lands
 * on the outgoing response. `httpOnly: false` because supabase-js on
 * the browser side reads these via document.cookie to keep its own
 * storage in sync — making them httpOnly would silently break the
 * client-side refresh path.
 */
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

export interface AuthContext {
  userId: string
  tenantId: string
  /** Legacy text role value from `tenant_members.role`. */
  role: string
  /** Resolved role key from the `roles` table — falls back to `role` if no roleId set. */
  roleKey: string
  /** Permission keys (e.g., `hpp.read`) granted by the user's role. Empty array if no role assigned. */
  permissions: string[]
  /** True when a platform admin has an active impersonation overriding tenantId/role/permissions. */
  impersonating: boolean
  /** Display name of the tenant being impersonated, if any. */
  impersonatedTenantName?: string
  /**
   * JUR-135: per-member branch scoping.
   *   - `null` ⇒ unrestricted (owner role, impersonation, or pre-JUR-135
   *     members with zero junction rows). Server fns must treat null as
   *     "all branches" and skip the scope check entirely.
   *   - `string[]` ⇒ restricted to exactly this set. Empty arrays cannot
   *     reach here (UI enforces ≥1 branch or the "all" toggle).
   *
   * Read once per request from `tenant_member_branches` in `requireAuth`.
   * Server fns use `assertBranchAllowed` / `filterBranchesByAccess`
   * helpers — never check `allowedBranchIds` directly.
   */
  allowedBranchIds: string[] | null
}

/**
 * Resolve a role's permissions. Accepts either a roleId (preferred) or a
 * roleKey as fallback — this lets us recover gracefully when a
 * `tenant_members` row was created without its `role_id` FK set but still
 * has the legacy `role` text column populated.
 */
export async function resolveRoleAndPermissions(opts: {
  roleId?: string | null
  roleKey?: string | null
}): Promise<{ roleKey: string | null; permissions: string[] }> {
  let roleId = opts.roleId ?? null
  let roleKey: string | null = null

  if (roleId) {
    const [role] = await db
      .select({ key: roles.key })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)
    if (role) roleKey = role.key
    else roleId = null // row deleted; fall through to key lookup
  }

  if (!roleId && opts.roleKey) {
    const [role] = await db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(eq(roles.key, opts.roleKey))
      .limit(1)
    if (role) {
      roleId = role.id
      roleKey = role.key
    }
  }

  if (!roleId) return { roleKey: null, permissions: [] }

  const perms = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissions)
    .innerJoin(
      permissionsTable,
      eq(rolePermissions.permissionId, permissionsTable.id),
    )
    .where(eq(rolePermissions.roleId, roleId))

  return { roleKey, permissions: perms.map((p) => p.key) }
}

/**
 * Returns the impersonation override for a user if (a) they're a platform admin and
 * (b) they have an active impersonation row. Otherwise returns null. Side-effect free.
 */
async function getImpersonationOverride(userId: string): Promise<{
  tenantId: string
  tenantName: string
  permissions: string[]
} | null> {
  const [admin] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1)
  if (!admin) return null

  const [impersonation] = await db
    .select({
      tenantId: activeImpersonations.tenantId,
      tenantName: tenants.businessName,
    })
    .from(activeImpersonations)
    .innerJoin(tenants, eq(activeImpersonations.tenantId, tenants.id))
    .where(eq(activeImpersonations.adminUserId, userId))
    .limit(1)
  if (!impersonation) return null

  // While impersonating, behave as the tenant's owner — fetch owner role permissions.
  const resolved = await resolveRoleAndPermissions({ roleKey: 'owner' })

  return {
    tenantId: impersonation.tenantId,
    tenantName: impersonation.tenantName,
    permissions: resolved.permissions,
  }
}

export async function requireAuth(): Promise<AuthContext> {
  const request = getRequest()
  const token = extractToken(request)

  // Diagnostic context for the auth-bounce investigation. We log the
  // bounded facts (path, cookie presence, refresh outcome) — never the
  // actual token bytes. Grep PM2 logs with `pm2 logs vintra-web |
  // grep '\[auth\]'` after a reproduction to see the exact branch.
  const reqPath = (() => {
    try {
      return new URL(request.url).pathname
    } catch {
      return '?'
    }
  })()
  const refreshTokenPresent = !!extractRefreshToken(request)

  if (!token) {
    console.warn(
      `[auth] no access token cookie path=${reqPath} refresh_present=${refreshTokenPresent}`,
    )
    throw new Error('Unauthorized')
  }

  const supabase = getSupabaseServer()

  // Try validating the access token
  let { data: { user }, error } = await supabase.auth.getUser(token)

  // If access token is expired, try refreshing with the refresh token.
  // On success we ALSO write the new pair back as cookies so:
  //   1. the next server request sees the fresh access token (no
  //      double-refresh on every page load),
  //   2. the cookie max-age resets — keeping active users signed in
  //      indefinitely while idle users still expire,
  //   3. browser-side supabase-js will pick up the new tokens via
  //      its cookie storage on the next event loop, staying in sync.
  if (error) {
    const refreshToken = extractRefreshToken(request)
    if (!refreshToken) {
      console.warn(
        `[auth] access invalid + no refresh cookie path=${reqPath} access_err=${error.message}`,
      )
    } else {
      console.log(
        `[auth] access invalid → trying refresh path=${reqPath} access_err=${error.message}`,
      )
      const refreshOutcome = await refreshSessionCoalesced(
        supabase,
        refreshToken,
      )
      const { data: refreshData, error: refreshError, cached } = refreshOutcome
      const source = cached ? 'cache' : 'fresh'
      if (!refreshError && refreshData.user && refreshData.session) {
        user = refreshData.user
        writeTokenCookies(
          refreshData.session.access_token,
          refreshData.session.refresh_token,
        )
        console.log(
          `[auth] refresh OK path=${reqPath} user=${user.id} source=${source}`,
        )
      } else {
        console.warn(
          `[auth] refresh FAILED path=${reqPath} source=${source} refresh_err=${refreshError?.message ?? 'no user/session'} status=${
            (refreshError as { status?: number } | null)?.status ?? '?'
          }`,
        )
      }
    }
  }

  if (!user) {
    throw new Error('Unauthorized')
  }

  // Find tenant membership for this user. memberId is needed for the
  // JUR-135 branch-scoping lookup below — we keep this query
  // single-row so it can serve both paths without a join.
  //
  // Selection order:
  //   1. If the request carries a valid `X-Tenant-Id` header (mobile
  //      multi-tenant path), look up THAT specific membership. Forged
  //      headers for tenants the user doesn't belong to are rejected
  //      below as NoTenant.
  //   2. Otherwise fall back to oldest membership (web path; one
  //      tenant per owner since migration 0069, but earlier races
  //      left some users with multiple — pinning to OLDEST keeps
  //      behavior stable + matches intuition "your original account").
  const requestedTenantId = extractRequestedTenantId(request)
  const membership = await (requestedTenantId
    ? db
        .select({
          memberId: tenantMembers.id,
          tenantId: tenantMembers.tenantId,
          role: tenantMembers.role,
          roleId: tenantMembers.roleId,
        })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.userId, user.id),
            eq(tenantMembers.tenantId, requestedTenantId),
          ),
        )
        .limit(1)
    : db
        .select({
          memberId: tenantMembers.id,
          tenantId: tenantMembers.tenantId,
          role: tenantMembers.role,
          roleId: tenantMembers.roleId,
        })
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, user.id))
        .orderBy(tenantMembers.createdAt)
        .limit(1))

  // Check for active impersonation override (platform admins only).
  // Impersonation always grants owner-level access so allowedBranchIds
  // stays null — admins shouldn't get pseudo-restrictions while
  // shadowing a tenant.
  const impersonation = await getImpersonationOverride(user.id)
  if (impersonation) {
    return {
      userId: user.id,
      tenantId: impersonation.tenantId,
      role: 'owner',
      roleKey: 'owner',
      permissions: impersonation.permissions,
      impersonating: true,
      impersonatedTenantName: impersonation.tenantName,
      allowedBranchIds: null,
    }
  }

  if (membership.length === 0) {
    // Check if user owns a tenant (legacy, before tenant_members was
    // guaranteed). When the request specified a tenant via header,
    // restrict the owner lookup to that tenant — otherwise a header
    // for someone else's tenant would silently fall back to the
    // user's own tenant, defeating the scoping intent.
    const ownedTenant = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(
        requestedTenantId
          ? and(
              eq(tenants.ownerId, user.id),
              eq(tenants.id, requestedTenantId),
            )
          : eq(tenants.ownerId, user.id),
      )
      .limit(1)

    if (ownedTenant.length === 0) {
      throw new Error('NoTenant')
    }

    // Synthesize an owner context (no DB role assigned)
    const resolved = await resolveRoleAndPermissions({ roleKey: 'owner' })

    return {
      userId: user.id,
      tenantId: ownedTenant[0]!.id,
      role: 'owner',
      roleKey: resolved.roleKey ?? 'owner',
      permissions: resolved.permissions,
      impersonating: false,
      // Synthetic owner context — never scoped.
      allowedBranchIds: null,
    }
  }

  const member = membership[0]!
  // Fall back to the text `role` when `role_id` FK is null (legacy rows)
  const resolved = await resolveRoleAndPermissions({
    roleId: member.roleId,
    roleKey: member.role,
  })

  // JUR-135: per-member branch scoping. Owner always = all branches
  // (skip the query). For everyone else, fetch the pinned branch set.
  // Zero rows ⇒ unrestricted (backward-compat for pre-JUR-135
  // members).
  const resolvedRoleKey = resolved.roleKey ?? member.role
  let allowedBranchIds: string[] | null = null
  if (resolvedRoleKey !== 'owner') {
    const pinnedRows = await db
      .select({ branchId: tenantMemberBranches.branchId })
      .from(tenantMemberBranches)
      .where(eq(tenantMemberBranches.tenantMemberId, member.memberId))
    if (pinnedRows.length > 0) {
      allowedBranchIds = pinnedRows.map((r) => r.branchId)
    }
  }

  return {
    userId: user.id,
    tenantId: member.tenantId,
    role: member.role,
    roleKey: resolvedRoleKey,
    permissions: resolved.permissions,
    impersonating: false,
    allowedBranchIds,
  }
}

export async function getOptionalAuth(): Promise<AuthContext | null> {
  try {
    return await requireAuth()
  } catch {
    return null
  }
}

/**
 * Throws `Forbidden` if the caller's role does not include the given permission key.
 * Permission keys follow the `module.action` convention (e.g., `hpp.write`).
 *
 * Accepts a single key or an array — array form passes if the caller has ANY
 * of the listed keys. Used for read endpoints that should be reachable via
 * either a `module.manage` or a softer `module.report` permission.
 */
export async function requirePermission(
  key: string | readonly string[],
): Promise<AuthContext> {
  const auth = await requireAuth()
  const keys = Array.isArray(key) ? key : [key]
  if (!keys.some((k) => auth.permissions.includes(k))) {
    throw new Error('Forbidden')
  }
  return auth
}
