import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createBrowserSupabase } from '@/lib/supabase'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

interface AuthUser {
  id: string
  email: string
  fullName?: string
}

interface AuthContextValue {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

import { SESSION_COOKIE_MAX_AGE_SECONDS } from '@/lib/session-cookies'

// Re-exported under the legacy name for callers that already import
// this from use-auth. New code should import from `@/lib/session-cookies`.
export { SESSION_COOKIE_MAX_AGE_SECONDS as SESSION_COOKIE_MAX_AGE } from '@/lib/session-cookies'

// Set Secure flag in production (HTTPS) — cookies stay JS-readable
// since Supabase JS reads/writes them, but at least they don't
// travel over plain HTTP. Skip in dev so localhost still works.
function cookieSecureFlag() {
  return typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? '; Secure'
    : ''
}

function setTokenCookies(session: Session) {
  const sec = cookieSecureFlag()
  document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${sec}`
  document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${sec}`
}

function clearTokenCookies() {
  document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax'
  document.cookie = 'sb-refresh-token=; path=/; max-age=0; SameSite=Lax'
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&')}=([^;]*)`),
  )
  return match ? decodeURIComponent(match[1]!) : null
}

export function useAuthProvider(): AuthContextValue {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef<SupabaseClient | null>(null)
  const lastUserIdRef = useRef<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabaseRef.current = supabase

    // Bootstrap supabase-js's storage from the server-managed cookies
    // BEFORE we read anything else. The server refreshes tokens during
    // SSR (in `getCurrentUser` / `requireAuth`) and writes the rotated
    // pair into cookies. supabase-js, meanwhile, has the pre-rotation
    // tokens sitting in localStorage — and its auto-refresh timer is
    // already armed against the OLD access-token's expiry. When that
    // timer fires it sends the stale refresh_token, gets back
    // "refresh_token_already_used", clears its session, and emits
    // SIGNED_OUT. The user appears logged out even though the cookies
    // are still perfectly valid.
    //
    // Calling `setSession` here forces supabase-js to adopt whatever
    // the cookies say — so its storage, its in-memory session, and
    // its refresh timer all line up with the server's truth. If the
    // cookies are missing or empty, this is a no-op and the normal
    // `getSession` path takes over.
    async function bootstrap() {
      const cookieAccess = readCookie('sb-access-token')
      const cookieRefresh = readCookie('sb-refresh-token')
      if (cookieAccess && cookieRefresh) {
        try {
          await supabase.auth.setSession({
            access_token: cookieAccess,
            refresh_token: cookieRefresh,
          })
        } catch {
          // setSession can throw if the access_token is malformed.
          // Fall through to getSession() — supabase-js will try to
          // refresh on its own.
        }
      }
      const {
        data: { session: s },
      } = await supabase.auth.getSession()
      if (s) {
        setSession(s)
        setUser({
          id: s.user.id,
          email: s.user.email!,
          fullName: s.user.user_metadata?.full_name as string | undefined,
        })
        lastUserIdRef.current = s.user.id
        // Sync cookies with the (possibly refreshed) session
        setTokenCookies(s)
      }
      setLoading(false)
    }
    bootstrap()

    // Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      const nextUserId = s?.user?.id ?? null
      // Drop every cached react-query result whenever the user identity
      // changes — otherwise things like the platform-admin-status from a
      // previous login leak into the new session's sidebar until staleTime
      // expires.
      //
      // BUT: skip on INITIAL_SESSION (page-load session restore) and on
      // the very first transition from null → user. In both cases, we're
      // not switching identities — we're picking up an existing one. If
      // we clear then, we wipe the fresh data that `getCurrentUser` is
      // loading, and the sidebar renders empty until react-query re-fetches.
      const isIdentityChange =
        event !== 'INITIAL_SESSION' &&
        lastUserIdRef.current !== null &&
        lastUserIdRef.current !== nextUserId
      if (isIdentityChange) {
        queryClient.clear()
      }
      lastUserIdRef.current = nextUserId
      if (s?.user) {
        setUser({
          id: s.user.id,
          email: s.user.email!,
          fullName: s.user.user_metadata?.full_name as string | undefined,
        })
        // Sync cookies on every token change (including auto-refresh)
        setTokenCookies(s)
      } else {
        setUser(null)
        // NEVER clear cookies from the auth-state listener. Even
        // `SIGNED_OUT` fires non-deterministically: cross-tab sync,
        // supabase-js client/server token mismatch after server-side
        // refresh, transient JWT-expired events, and HMR re-mounts in
        // dev all surface as SIGNED_OUT with a null session. Wiping
        // cookies on any of those bounces an active user to login on
        // their next navigation.
        //
        // Cookies are cleared exclusively by:
        //   1. the explicit `signOut()` callback below — user pressed
        //      logout, so we want it.
        //   2. the server-side middleware writing fresh cookies on a
        //      successful refresh (so the cookie always tracks the
        //      latest valid token).
        // Either way, leaving cookies alone here is safe: the server
        // re-validates on every request, so a truly invalidated session
        // throws Unauthorized at the next route guard and the user
        // lands on /auth/login organically.
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [queryClient])

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current ?? createBrowserSupabase()
    await supabase.auth.signOut()
    clearTokenCookies()
    setUser(null)
    setSession(null)
    // Belt-and-suspenders: also clear here, since the onAuthStateChange
    // listener may fire slightly later.
    queryClient.clear()
    lastUserIdRef.current = null
  }, [queryClient])

  return { user, session, loading, signOut }
}
