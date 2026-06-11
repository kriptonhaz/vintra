import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createBrowserSupabase } from '@/lib/supabase'
import { ensureTenantForOAuth } from '@/server/functions/auth'
import { SESSION_COOKIE_MAX_AGE } from '@/hooks/use-auth'
import { readRefCookie, clearRefCookie } from '@/lib/referral-cookie'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

function AuthCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const processed = useRef(false)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const supabase = createBrowserSupabase()

    // Listen for the auth state change triggered by the code exchange
    // The @supabase/ssr client auto-handles the ?code= param
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Set cookies for server-side auth
        // Long-lived + Secure-in-prod cookie pair. See the comment on
        // setTokenCookies in hooks/use-auth.ts for the full rationale.
        const sec = window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
        document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`

        // Ensure tenant exists for OAuth users (creates one if first
        // login). JUR-91: forward the referral code from the jq_ref
        // cookie so the attribution can be written alongside the new
        // tenant. The cookie's only purpose now is done — clear it
        // either way (success or "tenant already exists" no-op).
        const refCode = readRefCookie()
        try {
          await ensureTenantForOAuth({ data: { referralCode: refCode ?? undefined } })
        } catch {
          // Non-critical — tenant may already exist
        }
        if (refCode) clearRefCookie()

        navigate({ to: '/dashboard' })
      }
    })

    // Also check if session already exists (e.g. code was already exchanged)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Long-lived + Secure-in-prod cookie pair. See the comment on
        // setTokenCookies in hooks/use-auth.ts for the full rationale.
        const sec = window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
        document.cookie = `sb-refresh-token=${session.refresh_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`

        // JUR-91: same referral attribution path as the SIGNED_IN branch.
        const refCode = readRefCookie()
        try {
          await ensureTenantForOAuth({ data: { referralCode: refCode ?? undefined } })
        } catch {
          // Non-critical
        }
        if (refCode) clearRefCookie()

        navigate({ to: '/dashboard' })
      }
    })

    // Timeout: if no session after 10 seconds, show error
    const timeout = setTimeout(() => {
      setError(t('auth.callback.errorGoogleFailed'))
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
