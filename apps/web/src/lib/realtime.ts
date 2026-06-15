import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A dedicated browser Supabase client used ONLY for Realtime subscriptions.
 *
 * It is intentionally separate from the auth client in `use-auth.ts`. That
 * client has `autoRefreshToken: false` and a delicate cookie<->session sync
 * (see the long note in `lib/supabase.ts`); we don't want Realtime poking at
 * any of it. This client never persists or refreshes a session — instead the
 * caller feeds it the current access token via `client.realtime.setAuth(jwt)`
 * so RLS policies can authorize which rows stream through.
 *
 * A module-level singleton keeps a single websocket per tab no matter how
 * many components subscribe.
 */
let client: SupabaseClient | null = null

export function getRealtimeClient(): SupabaseClient {
  if (client) return client
  client = createClient(
    import.meta.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )
  return client
}

/**
 * Read the server-managed access token straight from the cookie. The server
 * middleware rotates `sb-access-token` on every request, so the cookie is the
 * freshest token available to long-lived browser code. Used to re-authorize
 * the Realtime socket periodically so its JWT doesn't go stale.
 */
export function readAccessTokenCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )sb-access-token=([^;]*)/)
  return match ? decodeURIComponent(match[1]!) : null
}
