import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getStockWatermark } from '@/server/functions/inventory'

/**
 * Keep stock-derived screens fresh across devices — a sale on another till, a
 * stock opname on the manager's phone, a PO receipt — without a manual refresh.
 *
 * Replaces `useInventoryRealtime`, which held a Supabase Realtime websocket
 * open from the ROOT authed layout: every signed-in user, on every page,
 * streaming `postgres_changes` payloads for `inventory_movements` (written on
 * every POS sale via BOM deduction) and `inventory_stock_balances`. Both tables
 * also carried `REPLICA IDENTITY FULL`, so each UPDATE shipped the entire old
 * row through the WAL as well. That is a lot of metered egress for a feature
 * whose only job is "refetch a few queries when stock moved".
 *
 * This polls a tiny watermark instead. The trade-offs, stated plainly:
 *
 *   - Latency goes from ~instant to at most POLL_MS. For "another till sold
 *     something, refresh the stock count" that is imperceptible.
 *   - Cost per client goes from an always-open socket streaming row payloads
 *     to one ~50-byte round trip every 20s.
 *   - Polling pauses while the tab is hidden, so background tabs on a
 *     cashier's phone cost nothing; `refetchOnWindowFocus` catches them up.
 */
const POLL_MS = 20_000

export function useInventorySync(tenantId: string | undefined) {
  const queryClient = useQueryClient()
  const lastVersion = useRef<string | null>(null)

  const { data } = useQuery({
    queryKey: ['inventory', 'watermark', tenantId],
    queryFn: () => getStockWatermark(),
    enabled: Boolean(tenantId),
    refetchInterval: POLL_MS,
    // Don't poll a tab nobody is looking at — the focus refetch below covers
    // the catch-up when the user comes back.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // This query IS the freshness signal, so it must never be served stale.
    staleTime: 0,
    gcTime: 0,
    // A blip shouldn't spam the console or the network; the next tick is only
    // 20s away.
    retry: false,
  })

  const version = data?.version

  useEffect(() => {
    if (!version) return

    // The first observation only establishes the baseline — invalidating here
    // would fire a redundant refetch on every mount.
    if (lastVersion.current === null) {
      lastVersion.current = version
      return
    }
    if (lastVersion.current === version) return
    lastVersion.current = version

    // Same invalidation set the Realtime handler used. Query keys are
    // branch-scoped (e.g. `['inventory', 'items', branchId]`) but
    // `invalidateQueries` matches by prefix, so these un-suffixed keys
    // invalidate every branch's cached view.
    //
    // Note the deliberate omission of `['inventory', 'stock-adjust']`: a
    // cashier mid-count needs a stable baseline, and the adjust page freezes
    // its own per-row values (see movements.adjust.tsx).
    queryClient.invalidateQueries({ queryKey: ['inventory', 'overview'] })
    queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] })
    queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] })
    queryClient.invalidateQueries({ queryKey: ['pos'] })
  }, [version, queryClient])

  // Reset the baseline when switching tenants (impersonation, or a user who
  // belongs to several) so the first watermark of the new tenant isn't
  // compared against the old one's.
  useEffect(() => {
    lastVersion.current = null
  }, [tenantId])
}
