/**
 * AuthProvider — single source of truth for the Supabase session +
 * the convenience auth actions (signIn / signOut / resetPassword).
 *
 * Session lifecycle:
 *   1. On mount, read the persisted session from expo-secure-store
 *      (Supabase does this for us under the hood — we just await
 *      `getSession()` and reflect the result into React state).
 *   2. Subscribe to `onAuthStateChange` so token refreshes and
 *      sign-outs from other tabs/devices keep our state in sync.
 *
 * Why a custom provider when Supabase already manages state? Two
 * reasons: (a) we want a single `loading` flag the root layout can
 * gate on so we don't paint a sign-in screen flash while a valid
 * session restores, (b) we want one place to centralize the
 * Indonesian error strings instead of scattering them across screens.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextValue {
  /** True while session restore + first auth-state event are pending. */
  loading: boolean
  session: Session | null
  user: User | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const queryClient = useQueryClient()
  // Tracks the previously-seen user id so we can detect an account switch.
  // `undefined` = not yet initialized (don't treat the first observation
  // as a change); `null` = signed out.
  const prevUserIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    function applySession(next: Session | null) {
      if (cancelled) return
      const nextUserId = next?.user?.id ?? null
      // On a user CHANGE (login as a different account, or logout), wipe
      // the React Query cache. Queries are keyed by tenantId — which two
      // users can share — so without this the new session is served the
      // previous user's cached data (e.g. their attendance profile) until
      // a manual refetch. Skip on the very first observation and on
      // same-user token refreshes.
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== nextUserId
      ) {
        queryClient.clear()
      }
      prevUserIdRef.current = nextUserId
      setSession(next)
      // `getSession()` may resolve after the first auth-state event in
      // some race conditions — flipping loading here too is harmless and
      // guarantees the gate clears.
      setLoading(false)
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session))

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) =>
      applySession(next),
    )

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        return { error: error?.message ?? null }
      },
      signOut: async () => {
        // Best-effort server invalidation first — fire-and-forget so
        // a network blip doesn't strand the user on a logged-in shell
        // they can't escape. The local clear below always runs.
        //
        // Default `scope: 'global'` makes a synchronous network call
        // to invalidate the refresh token. On a spotty mobile
        // connection (Indonesian cell data, especially in warungs),
        // that throws "Network request failed" — and the local
        // session would NEVER be cleared, leaving the user stuck on
        // a logged-in shell that can't reach the API.
        void supabase.auth.signOut({ scope: 'global' }).catch(() => {})
        await supabase.auth.signOut({ scope: 'local' })
      },
      resetPassword: async (email) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        return { error: error?.message ?? null }
      },
    }),
    [loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
