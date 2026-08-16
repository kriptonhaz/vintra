import { createClient } from '@supabase/supabase-js'

/**
 * Browser-side Supabase client. Uses plain `@supabase/supabase-js`
 * (NOT `@supabase/ssr`) on purpose:
 *
 * `@supabase/ssr`'s `createBrowserClient` writes its own session
 * cookies (`sb-<project>-auth-token.0`, `.1`, etc.) which are
 * SEPARATE from the `sb-access-token` / `sb-refresh-token` pair our
 * server middleware reads. Two parallel cookie sets drift out of
 * sync — when supabase-js refreshes client-side it rotates ITS
 * cookies, but the server still sees the stale `sb-access-token`
 * until `setTokenCookies` fires from the auth-state listener. With
 * refresh-token rotation, that lag is enough to invalidate the
 * server's next refresh attempt ("refresh_token_already_used"), and
 * the user gets bounced to /auth/login.
 *
 * Using plain `createClient` makes the browser side store sessions
 * in localStorage. The `onAuthStateChange` handler in `use-auth.ts`
 * mirrors every refresh into our manual `sb-access-token` /
 * `sb-refresh-token` cookies — single source of truth on the wire,
 * server and client always agree.
 *
 * `autoRefreshToken: false` is INTENTIONAL: the server middleware
 * (`requireAuth` in apps/web/src/server/middleware/auth.ts) is the
 * single refresh authority. With auto-refresh enabled, supabase-js's
 * background timer and a concurrent server request would both try
 * to consume the same single-use refresh token and one of them got
 * "refresh_token_already_used", silently logging the user out after
 * a few hours of idle. Since every data path in this app goes
 * through TanStack server functions (which always invoke
 * `requireAuth`), the browser never needs a fresh access token of
 * its own — the server refreshes on every request and writes the
 * rotated pair back via Set-Cookie. The bootstrap in `use-auth.ts`
 * calls `setSession()` once on mount to align supabase-js's
 * in-memory session with the cookies for code that reads
 * `session.user`. If we ever add direct browser→Supabase calls
 * (Realtime, Storage, RLS-protected `.from()`), revisit this.
 *
 * `detectSessionInUrl: true` keeps the OAuth ?code= callback flow
 * working at /auth/callback (same behaviour @supabase/ssr provided).
 *
 * SINGLETON (do NOT remove): every caller shares ONE GoTrueClient per
 * browser context. PKCE auth codes are single-use, and `detectSessionInUrl`
 * triggers the code exchange the moment a client initializes. When two
 * clients existed at once (the global one in `useAuthProvider` plus the
 * per-route one in `/auth/callback`), both spotted the same `?code=` on
 * page load and fired `exchangeCodeForSession` concurrently — GoTrue
 * rejected the racing requests as "Possible abuse attempt" (HTTP 400),
 * SIGNED_IN never fired, and the callback's timeout showed
 * "Gagal masuk dengan Google" on the first try (it only "worked" on a
 * retry when the timing happened to line up). A single shared instance
 * exchanges the code exactly once. This also silences supabase-js's
 * "Multiple GoTrueClient instances detected" warning.
 */
let browserClient: ReturnType<typeof createClient> | null = null

export function createBrowserSupabase() {
  if (browserClient) return browserClient
  browserClient = createClient(
    import.meta.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    },
  )
  return browserClient
}

export function createServerSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}
