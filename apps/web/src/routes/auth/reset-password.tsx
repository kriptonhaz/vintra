import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import {
  setPasswordSchema,
  type SetPasswordInput,
} from '@vintra/shared'
import { createBrowserSupabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import logoWordmark from '@/assets/images/logo-wordmark.png'
import logoWordmarkWhite from '@/assets/images/logo-wordmark-white.png'

export const Route = createFileRoute('/auth/reset-password')({
  component: ResetPasswordPage,
})

type Stage =
  /** Waiting for Supabase to consume the recovery token in the URL hash. */
  | 'verifying'
  /** Recovery session established; show the new-password form. */
  | 'ready'
  /** No recovery session arrived (manual nav, wrong browser, etc.). */
  | 'invalid'
  /** Supabase explicitly rejected the link with otp_expired. */
  | 'expired'
  /** Update succeeded; user is being redirected to login. */
  | 'success'

/**
 * Parse Supabase's recovery hash into the access/refresh token pair.
 * The recovery email uses Supabase's legacy implicit flow which dumps
 * the tokens into the URL fragment — our browser client is configured
 * for `flowType: 'pkce'` (the modern OAuth path) and ignores the hash
 * entirely. We have to extract the tokens manually and call setSession
 * ourselves; once that lands, supabase-js treats the page as authed
 * and updateUser({ password }) works.
 */
function parseRecoveryHash(): { accessToken: string; refreshToken: string } | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash || !hash.includes('type=recovery')) return null
  const params = new URLSearchParams(hash.slice(1))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>('verifying')
  const [serverError, setServerError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    let cancelled = false

    // Pre-flight #1: Supabase signals an expired/used link with
    // `error=access_denied&error_code=otp_expired`. Depending on the flow
    // this lands in the query string (`?…`) OR the URL fragment (`#…`) —
    // the implicit/recovery flow uses the hash. Check BOTH; otherwise a
    // re-opened (single-use, already-consumed) link slips past here, falls
    // through to the stale-session fallback below, and shows a broken form
    // that fails with "User from sub claim in JWT does not exist".
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const errorCode = search.get('error_code') ?? hash.get('error_code')
      const error = search.get('error') ?? hash.get('error')
      if (errorCode === 'otp_expired' || error === 'access_denied') {
        // Drop any stale recovery session so a later visit doesn't reuse
        // it (it may belong to a since-deleted user).
        void supabase.auth.signOut()
        setStage('expired')
        return
      }
    }

    // Pre-flight #2: PKCE recovery URL (`?code=…`). The Supabase
    // project's email auth flow is set to PKCE, so recovery links
    // arrive as `?code=…` instead of the legacy `#access_token=…`
    // hash. exchangeCodeForSession trades the code for a real session;
    // failures (expired / already-used code) drop into the "expired"
    // copy — same UX as the otp_expired branch above. This was the
    // bug behind the multi-user "Cloudflare error" reports: our page
    // ignored ?code= entirely and silently fell into the 4s timeout.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      if (code) {
        void supabase.auth
          .exchangeCodeForSession(code)
          .then(({ error }) => {
            if (cancelled) return
            if (error) {
              setStage('expired')
              return
            }
            // Scrub the code from the URL bar so a refresh / bookmark
            // doesn't re-attempt the (now-consumed) one-time code.
            window.history.replaceState(null, '', '/auth/reset-password')
            setStage('ready')
          })
        return () => {
          cancelled = true
        }
      }
    }

    // Pre-flight #3: legacy implicit-flow hash (`#access_token=…&type=recovery`).
    // Kept for back-compat in case the Supabase project flips its flow
    // type back, or older outstanding links arrive after a config change.
    const tokens = parseRecoveryHash()
    if (tokens) {
      void supabase.auth
        .setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        })
        .then(({ error }) => {
          if (cancelled) return
          if (error) {
            // setSession rejects on expired/invalid JWTs — same UX as
            // the explicit otp_expired branch above.
            setStage('expired')
            return
          }
          // Clear the tokens from the URL bar so a manual reload or a
          // bookmark doesn't leak them. The recovery session is now
          // alive in localStorage / cookies.
          window.history.replaceState(null, '', '/auth/reset-password')
          setStage('ready')
        })
      return () => {
        cancelled = true
      }
    }

    // Fallback path: no code, no hash, no error — try the session in
    // case it was already established. If still nothing after 4s, the
    // user landed here via a stale bookmark or manual nav.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session) setStage('ready')
    })

    const timeout = setTimeout(() => {
      if (!cancelled) {
        setStage((prev) => (prev === 'verifying' ? 'invalid' : prev))
      }
    }, 4000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [])

  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(values: SetPasswordInput) {
    setServerError(null)
    const supabase = createBrowserSupabase()
    const { error: updateError } = await supabase.auth.updateUser({
      password: values.newPassword,
    })
    if (updateError) {
      // A stale/invalid recovery session (e.g. the link was already used,
      // or the user was removed) surfaces as "User from sub claim in JWT
      // does not exist" / a session error. Route to the clear "request a
      // new link" screen instead of dumping the raw Supabase string.
      const msg = updateError.message.toLowerCase()
      if (
        msg.includes('sub claim') ||
        msg.includes('user not found') ||
        msg.includes('session') ||
        msg.includes('jwt')
      ) {
        await supabase.auth.signOut()
        setStage('expired')
        return
      }
      setServerError(updateError.message)
      return
    }
    // Sign out the recovery session so the user has to log in fresh
    // with the new password — avoids any "am I still logged in?"
    // ambiguity if they later visit a protected route.
    await supabase.auth.signOut()
    setStage('success')
    setTimeout(() => {
      navigate({ to: '/auth/login' })
    }, 1500)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-10 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          {/* Brand header — dark wordmark on light surface, white in dark mode */}
          <img
            src={logoWordmark}
            alt="Vintra"
            className="mx-auto mb-4 h-8 w-auto dark:hidden"
          />
          <img
            src={logoWordmarkWhite}
            alt="Vintra"
            className="mx-auto mb-4 hidden h-8 w-auto dark:block"
          />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('auth.resetPassword.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('auth.resetPassword.subtitle')}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-8">
          {stage === 'verifying' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('auth.resetPassword.verifying')}
              </p>
            </div>
          )}

          {stage === 'invalid' && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-500/20">
                <AlertCircle className="h-6 w-6 text-danger-600 dark:text-danger-400" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
                {t('auth.resetPassword.invalidTitle')}
              </h3>
              <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
                {t('auth.resetPassword.invalidBody')}
              </p>
              <a
                href="/auth/forgot-password"
                className="inline-block rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                {t('auth.resetPassword.invalidRequestNew')}
              </a>
            </div>
          )}

          {stage === 'expired' && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning-100 dark:bg-warning-500/20">
                <Clock className="h-6 w-6 text-warning-700 dark:text-warning-400" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
                {t('auth.resetPassword.expiredTitle')}
              </h3>
              <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
                {t('auth.resetPassword.expiredBody')}
              </p>
              <a
                href="/auth/forgot-password"
                className="inline-block rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                {t('auth.resetPassword.expiredRequestNew')}
              </a>
            </div>
          )}

          {stage === 'success' && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-500/20">
                <CheckCircle2 className="h-6 w-6 text-brand-600 dark:text-brand-400" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
                {t('auth.resetPassword.successTitle')}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('auth.resetPassword.successBody')}
              </p>
            </div>
          )}

          {stage === 'ready' && (
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5"
            >
              {serverError && (
                <div className="rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-400">
                  {serverError}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('auth.resetPassword.fieldNewPassword')}
                </label>
                <div className="relative">
                  <Input
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    error={form.formState.errors.newPassword?.message}
                    className="pr-10"
                    {...form.register('newPassword')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((s) => !s)}
                    aria-label={
                      showNew
                        ? t('auth.resetPassword.hidePasswordAria')
                        : t('auth.resetPassword.showPasswordAria')
                    }
                    className="absolute right-2 top-5 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showNew ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {!form.formState.errors.newPassword && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('auth.resetPassword.minLengthHint')}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('auth.resetPassword.fieldConfirmPassword')}
                </label>
                <div className="relative">
                  <Input
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    error={form.formState.errors.confirmPassword?.message}
                    className="pr-10"
                    {...form.register('confirmPassword')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((s) => !s)}
                    aria-label={
                      showConfirm
                        ? t('auth.resetPassword.hidePasswordAria')
                        : t('auth.resetPassword.showPasswordAria')
                    }
                    className="absolute right-2 top-5 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="brand"
                className="w-full"
                loading={form.formState.isSubmitting}
              >
                {t('auth.resetPassword.submit')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
