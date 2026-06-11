/**
 * OutletProvider — mobile mirror of apps/web/src/hooks/use-branch.tsx.
 *
 * Holds the "which outlet am I operating" selection that scopes every
 * branch-aware module (POS catalog, inventory list, home dashboard
 * widgets) on mobile. Persisted to expo-secure-store so it survives
 * cold starts.
 *
 * Visibility is data-driven (matches web):
 *   - branches.length === 0           → context idle (loading or no outlets)
 *   - totalCount <= 1                 → tenant has one outlet, don't render chip
 *   - branches.length === 1, total>1  → staff pinned to one of many, render locked
 *   - branches.length  >  1           → render switcher
 *
 * The list returned by `listAccessibleBranches` is already filtered by
 * `tenant_member_branches` server-side, so anything we receive is fair
 * game. A stored id no longer in the allowed set is silently dropped
 * (self-heal) instead of surfacing an error.
 *
 * Naming note: the DB calls these `branches`. We use "outlet" in
 * mobile UI copy (matches how operators talk) but keep `branchId` as
 * the wire name on every server call.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export interface OutletOption {
  id: string
  name: string
  isMain: boolean
}

interface AccessibleBranchesResponse {
  branches: OutletOption[]
  totalCount: number
}

interface OutletContextValue {
  /** Outlets the current member may operate, main branch first. */
  branches: OutletOption[]
  /** Active outlets in the whole tenant (lets UI tell single-outlet
   *  tenants apart from staff scoped to one of many). */
  totalCount: number
  /** null only before outlets have loaded or when the tenant has none. */
  selectedBranchId: string | null
  selectedBranch: OutletOption | null
  setSelectedBranchId: (id: string) => void
  loading: boolean
}

const OutletContext = createContext<OutletContextValue | null>(null)

const STORAGE_KEY = 'jq.selected_outlet_id'

export function OutletProvider({ children }: { children: ReactNode }) {
  const { tenantId } = useTenant()

  const { data, isLoading } = useQuery({
    // Key by tenant so switching businesses re-fetches; otherwise we'd
    // briefly show the previous tenant's outlets after `Ganti Usaha`.
    queryKey: ['accessible-branches', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<AccessibleBranchesResponse>('listAccessibleBranches', {}),
    staleTime: 5 * 60 * 1000,
  })

  const branches = useMemo<OutletOption[]>(
    () => data?.branches ?? [],
    [data],
  )
  const totalCount = data?.totalCount ?? branches.length

  const [selectedBranchId, setSelected] = useState<string | null>(null)
  // Track whether we've already seeded from SecureStore so the
  // self-heal effect doesn't keep overwriting an in-flight user pick.
  const storedRef = useRef<string | null | undefined>(undefined)

  // Read the persisted selection once per tenant. Re-reading on tenant
  // change matters: switching `Ganti Usaha` should restart from a
  // clean slate, not carry the prior tenant's outlet id forward.
  useEffect(() => {
    let cancelled = false
    storedRef.current = undefined
    setSelected(null)

    void (async () => {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY).catch(
        () => null,
      )
      if (cancelled) return
      storedRef.current = stored
    })()

    return () => {
      cancelled = true
    }
  }, [tenantId])

  // Seed (and self-heal) the selection once both the outlet list and
  // the stored id have resolved. Order of preference:
  //   1. keep the current pick if still valid
  //   2. restore from SecureStore if still valid
  //   3. fall back to the main branch (or first if no main)
  useEffect(() => {
    if (branches.length === 0) return
    if (storedRef.current === undefined) return // SecureStore read not done yet
    setSelected((prev) => {
      if (prev && branches.some((b) => b.id === prev)) return prev
      const stored = storedRef.current
      if (stored && branches.some((b) => b.id === stored)) return stored
      return (branches.find((b) => b.isMain) ?? branches[0]!).id
    })
  }, [branches])

  const setSelectedBranchId = useCallback((id: string) => {
    setSelected(id)
    storedRef.current = id
    void SecureStore.setItemAsync(STORAGE_KEY, id).catch(() => {
      // SecureStore writes are best-effort; failing to persist just
      // means the next cold start falls back to the main branch.
    })
  }, [])

  const value = useMemo<OutletContextValue>(
    () => ({
      branches,
      totalCount,
      selectedBranchId,
      selectedBranch:
        branches.find((b) => b.id === selectedBranchId) ?? null,
      setSelectedBranchId,
      loading: isLoading,
    }),
    [
      branches,
      totalCount,
      selectedBranchId,
      setSelectedBranchId,
      isLoading,
    ],
  )

  return (
    <OutletContext.Provider value={value}>{children}</OutletContext.Provider>
  )
}

export function useOutlet(): OutletContextValue {
  const ctx = useContext(OutletContext)
  if (!ctx) {
    throw new Error('useOutlet must be used inside <OutletProvider>')
  }
  return ctx
}
