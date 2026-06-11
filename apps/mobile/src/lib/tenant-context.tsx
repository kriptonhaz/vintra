/**
 * TenantProvider — once signed in, the user picks (or auto-resolves)
 * a tenant. The picked tenantId rides on every API call via the
 * X-Tenant-Id header so the server scopes data correctly when a user
 * belongs to multiple businesses.
 *
 * State machine:
 *   loading        → fetching tenant list
 *   no-tenants     → user has no tenant access (shouldn't happen in v1;
 *                    treat as forced sign-out)
 *   needs-picker   → multiple tenants, no last-used persisted → show picker
 *   ready          → tenantId resolved, app can call scoped endpoints
 *
 * `lastUsedTenantId` is persisted to expo-secure-store so subsequent
 * launches skip the picker even with multi-tenant users.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import * as SecureStore from 'expo-secure-store'
import { useAuth } from './auth-context'
import { callServerFn } from './api'

export interface TenantSummary {
  id: string
  businessName: string
  slug: string | null
  /** Legacy text role from tenant_members.role (e.g. "owner", "cashier"). */
  role: string
  /** Canonical role key resolved from the roles table; falls back to `role`. */
  roleKey: string
  /** Permission keys granted by the role (e.g. "pos.read"). Drives role-aware UI. */
  permissions: string[]
}

type TenantState =
  | { status: 'loading' }
  | { status: 'no-tenants' }
  | { status: 'needs-picker'; tenants: TenantSummary[] }
  | {
      status: 'ready'
      tenant: TenantSummary
      tenants: TenantSummary[]
    }

interface TenantContextValue {
  state: TenantState
  /** Convenience: the active tenant id when status === 'ready', else null. */
  tenantId: string | null
  /** Permission keys for the active tenant (empty until status === 'ready'). */
  permissions: string[]
  /** True if the active tenant's role grants `key` (e.g. "pos.read"). */
  hasPermission: (key: string) => boolean
  /** Pick a tenant (used by both the picker screen and the More-tab switcher). */
  selectTenant: (tenantId: string) => Promise<void>
  /** Clear the current selection — used when signing out. */
  clear: () => Promise<void>
}

const LAST_TENANT_KEY = 'jq.last_tenant_id'

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const [state, setState] = useState<TenantState>({ status: 'loading' })
  const [tenants, setTenants] = useState<TenantSummary[]>([])

  // Reload the tenant list whenever the user changes (sign-in /
  // sign-out / token refresh that swaps users). Sign-out flips
  // session to null → we reset to loading and let the route guard
  // bounce to /auth/login.
  useEffect(() => {
    if (!session) {
      setState({ status: 'loading' })
      setTenants([])
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        const list = await callServerFn<TenantSummary[]>(
          'listMyTenants',
          {},
        )
        if (cancelled) return
        setTenants(list)

        if (list.length === 0) {
          setState({ status: 'no-tenants' })
          return
        }

        if (list.length === 1) {
          await SecureStore.setItemAsync(LAST_TENANT_KEY, list[0]!.id)
          setState({ status: 'ready', tenant: list[0]!, tenants: list })
          return
        }

        const lastUsed = await SecureStore.getItemAsync(LAST_TENANT_KEY)
        const match = lastUsed ? list.find((t) => t.id === lastUsed) : null
        if (match) {
          setState({ status: 'ready', tenant: match, tenants: list })
        } else {
          setState({ status: 'needs-picker', tenants: list })
        }
      } catch (err) {
        console.warn('[tenant] listMyTenants failed:', err)
        // Network error or 401 — treat as needing re-auth by flipping
        // to no-tenants so the route guard can react. AuthProvider's
        // own error handling will catch the 401 and clear the session.
        if (!cancelled) setState({ status: 'no-tenants' })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [session])

  const selectTenant = useCallback(
    async (tenantId: string) => {
      const found = tenants.find((t) => t.id === tenantId)
      if (!found) throw new Error('Tenant tidak ditemukan')
      await SecureStore.setItemAsync(LAST_TENANT_KEY, tenantId)
      setState({ status: 'ready', tenant: found, tenants })
    },
    [tenants],
  )

  const clear = useCallback(async () => {
    await SecureStore.deleteItemAsync(LAST_TENANT_KEY)
    setState({ status: 'loading' })
    setTenants([])
  }, [])

  const permissions = state.status === 'ready' ? (state.tenant.permissions ?? []) : []

  const value = useMemo<TenantContextValue>(
    () => ({
      state,
      tenantId: state.status === 'ready' ? state.tenant.id : null,
      permissions,
      hasPermission: (key: string) => permissions.includes(key),
      selectTenant,
      clear,
    }),
    [state, permissions, selectTenant, clear],
  )

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  )
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used inside <TenantProvider>')
  return ctx
}
