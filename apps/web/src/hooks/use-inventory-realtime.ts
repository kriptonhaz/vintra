import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { getRealtimeClient, readAccessTokenCookie } from '@/lib/realtime'

// Re-authorize the long-lived Realtime socket every few minutes so its JWT
// can't expire underneath an idle stock screen.
const REAUTH_INTERVAL_MS = 4 * 60 * 1000

/**
 * Subscribe to live inventory changes for the current tenant. Whenever a stock
 * balance or movement row changes anywhere (a sale on another till, a stock
 * opname on the manager's phone, a PO receipt), every device viewing the
 * inventory overview, items list, movements ledger, or POS cashier refetches
 * automatically.
 *
 * Notes:
 *  - We deliberately do NOT invalidate the `['inventory', 'stock-adjust']`
 *    count sheet. A cashier mid-count needs a stable baseline; the adjust page
 *    freezes its own per-row baseline instead (see movements.adjust.tsx).
 *  - Delivery is gated by RLS (migration 0137), so the socket only ever
 *    receives rows for tenants the signed-in user belongs to.
 *  - Query keys are branch-scoped (e.g. `['inventory', 'items', branchId]`),
 *    but `invalidateQueries` matches by key prefix, so the un-suffixed keys
 *    below invalidate every branch's cached view.
 */
export function useInventoryRealtime(tenantId: string | undefined) {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const accessToken = session?.access_token

  useEffect(() => {
    if (!tenantId) return
    const token = accessToken ?? readAccessTokenCookie()
    if (!token) return

    const supabase = getRealtimeClient()
    supabase.realtime.setAuth(token)

    // Coalesce bursts: a checkout rush across several tills can fire many
    // balance/movement events in a second. Debounce so we refetch once the
    // dust settles instead of once per event.
    let debounce: ReturnType<typeof setTimeout> | undefined
    const invalidate = () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['inventory', 'overview'] })
        queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] })
        queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] })
        queryClient.invalidateQueries({ queryKey: ['pos'] })
      }, 400)
    }

    const channel = supabase
      .channel(`stock:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_stock_balances',
          filter: `tenant_id=eq.${tenantId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_movements',
          filter: `tenant_id=eq.${tenantId}`,
        },
        invalidate,
      )
      .subscribe((status) => {
        // If the socket drops or its JWT expires, re-apply the freshest token
        // and supabase-js will rejoin the channel.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const fresh = readAccessTokenCookie()
          if (fresh) supabase.realtime.setAuth(fresh)
        }
      })

    const reauth = setInterval(() => {
      const fresh = readAccessTokenCookie()
      if (fresh) supabase.realtime.setAuth(fresh)
    }, REAUTH_INTERVAL_MS)

    return () => {
      clearTimeout(debounce)
      clearInterval(reauth)
      supabase.removeChannel(channel)
    }
  }, [tenantId, accessToken, queryClient])
}
