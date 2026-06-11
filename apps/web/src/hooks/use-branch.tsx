import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAccessibleBranches } from '@/server/functions/attendance-branches'

/**
 * Global "which branch am I operating" selection — the Qasir-style
 * branch switcher. The selection is shared across every branch-aware
 * module (inventory, POS, attendance, booking) so switching in one
 * carries to the rest, and persisted to localStorage so it survives
 * reloads.
 *
 * The selected branch is always one the member is *allowed* to see —
 * `listAccessibleBranches` already applies `tenant_member_branches`
 * scoping, and a stored id that is no longer in the allowed set is
 * silently discarded on the next load.
 */

export interface BranchOption {
  id: string
  name: string
  isMain: boolean
}

interface BranchContextValue {
  /** Branches the current member may operate (main branch first). */
  branches: BranchOption[]
  /** Active branch count for the whole tenant — see listAccessibleBranches. */
  totalCount: number
  /** null only before branches have loaded, or when the tenant has none. */
  selectedBranchId: string | null
  selectedBranch: BranchOption | null
  setSelectedBranchId: (id: string) => void
  loading: boolean
}

const BranchContext = createContext<BranchContextValue | null>(null)

const STORAGE_KEY = 'jq.selectedBranchId'

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['accessible-branches'],
    queryFn: () => listAccessibleBranches(),
    staleTime: 5 * 60 * 1000,
  })

  const branches = useMemo<BranchOption[]>(() => data?.branches ?? [], [data])
  const totalCount = data?.totalCount ?? branches.length

  const [selectedBranchId, setSelected] = useState<string | null>(null)

  // Seed (and self-heal) the selection once branches resolve. Order of
  // preference: keep the current pick → restore from localStorage →
  // fall back to the main branch. A stale stored id that is no longer
  // accessible is dropped here rather than ever being surfaced.
  useEffect(() => {
    if (branches.length === 0) return
    setSelected((prev) => {
      if (prev && branches.some((b) => b.id === prev)) return prev
      const stored =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(STORAGE_KEY)
          : null
      if (stored && branches.some((b) => b.id === stored)) return stored
      return (branches.find((b) => b.isMain) ?? branches[0]!).id
    })
  }, [branches])

  const setSelectedBranchId = useCallback((id: string) => {
    setSelected(id)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, id)
    }
  }, [])

  const value = useMemo<BranchContextValue>(() => {
    return {
      branches,
      totalCount,
      selectedBranchId,
      selectedBranch:
        branches.find((b) => b.id === selectedBranchId) ?? null,
      setSelectedBranchId,
      loading: isLoading,
    }
  }, [branches, totalCount, selectedBranchId, setSelectedBranchId, isLoading])

  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  )
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext)
  if (!ctx) {
    throw new Error('useBranch must be used within a BranchProvider')
  }
  return ctx
}
