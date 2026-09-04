import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createBrowserSupabase } from '@/lib/supabase'
import { ensureTenantForOAuth } from '@/server/functions/auth'
import { SESSION_COOKIE_MAX_AGE } from '@/hooks/use-auth'
import { readRefCookie, clearRefCookie } from '@/lib/referral-cookie'
import { readSignupIntent, clearSignupIntent } from '@/lib/signup-intent-cookie'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

/** Tenant the user already belongs to, when they arrived via "Daftar". */
type ExistingMembership = { tenantName: string; roleLabel: string }

function AuthCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState<ExistingMembership | null>(null)
  const processed = useRef(false)
  // Separate from `processed`: that one only stops the EFFECT running
  // twice under StrictMode. Both the SIGNED_IN subscription and the
  // getSession() fallback can still fire for a single callback, and
  // without this the second one re-navigates over the notice the first
  // one just put on screen.
  const finished = useRef(false)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const supabase = createBrowserSupabase()

    // Long-lived + Secure-in-prod cookie pair. See the comment on
    // setTokenCookies in hooks/use-auth.ts for the full rationale.
    function setTokenCookies(session: {
      access_token: string
      refresh_token: string
    }) {
      const sec = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
      document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
    }

    async function completeSignIn(session: {
      access_token: string
      refresh_token: string
    }) {
      if (finished.current) return
      finished.current = true

      setTokenCookies(session)

      // Was this OAuth round-trip started from "Daftar" rather than
      // "Masuk"? Read before the await so a slow server fn can't race
      // the cookie's 10-minute expiry.
      const wantedNewBusiness = readSignupIntent()
      clearSignupIntent()

      // Ensure tenant exists for OAuth users (creates one if first
      // login). JUR-91: forward the referral code from the jq_ref
      // cookie so the attribution can be written alongside the new
      // tenant. The cookie's only purpose now is done — clear it
      // either way (success or "tenant already exists" no-op).
      const refCode = readRefCookie()
      let alreadyMemberOf: ExistingMembership | null = null
      try {
        const result = await ensureTenantForOAuth({
          data: { referralCode: refCode ?? undefined },
        })
        alreadyMemberOf = result?.existingMembership ?? null
      } catch {
        // Non-critical — tenant may already exist
      }
      if (refCode) clearRefCookie()

      // Someone pressed "Daftar" on an account that already belongs to
      // a business. No tenant was created (UNIQUE(owner_id) makes a
      // second one impossible anyway), so say plainly where they are
      // going instead of dropping them into a shop they didn't expect.
      if (wantedNewBusiness && alreadyMemberOf) {
        setExisting(alreadyMemberOf)
        return
      }

      navigate({ to: '/dashboard' })
    }

    // Listen for the auth state change triggered by the code exchange
    // The @supabase/ssr client auto-handles the ?code= param
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await completeSignIn(session)
      }
    })

    // Also check if session already exists (e.g. code was already exchanged)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) await completeSignIn(session)
    })

    // Timeout: if no session after 10 seconds, show error
    const timeout = setTimeout(() => {
      if (!finished.current) setError(t('auth.callback.errorGoogleFailed'))
    }, 10000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [navigate, t])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="rounded-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
          <p className="text-sm text-danger-600 dark:text-danger-500">{error}</p>
          <button
            onClick={() => navigate({ to: '/auth/login' })}
            className="mt-4 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            {t('auth.callback.backToLogin')}
          </button>
        </div>
      </div>
    )
  }

  if (existing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-lg dark:bg-gray-800">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('auth.callback.alreadyMemberTitle')}
          </h1>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            {t('auth.callback.alreadyMemberBody', {
              role: existing.roleLabel,
              tenant: existing.tenantName,
            })}
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('auth.callback.alreadyMemberHint')}
          </p>
          <button
            onClick={() => navigate({ to: '/dashboard' })}
            className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t('auth.callback.alreadyMemberCta', {
              tenant: existing.tenantName,
            })}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {t('auth.callback.processing')}
        </p>
      </div>
    </div>
  )
}
