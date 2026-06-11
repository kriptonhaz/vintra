import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, Lock, Eye, EyeOff, HelpCircle, MessageCircle } from 'lucide-react'
// JUR-138: load i18n module here so head() can call i18n.t() before
// the component mounts (head runs in createFileRoute closure, outside
// React's <Suspense> for resources).
import i18n from '@/lib/i18n'
import { createBrowserSupabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { loginSchema, type LoginFormData } from '@/lib/schemas/login'
import { SESSION_COOKIE_MAX_AGE } from '@/hooks/use-auth'
import { getCurrentUser, checkLoginAuthMethod } from '@/server/functions/auth'
import loginHero from '@/assets/images/login-hero.png'
import logoWordmark from '@/assets/images/logo-wordmark.png'
import logoWordmarkWhite from '@/assets/images/logo-wordmark-white.png'

export const Route = createFileRoute('/auth/login')({
  head: () => ({
    meta: [
      { title: i18n.t('auth.login.metaTitle') },
      {
        name: 'description',
        content: i18n.t('auth.login.metaDescription'),
      },
    ],
  }),
  /**
   * Skip the login form when there's already a valid session — getCurrentUser
   * returns non-null when the access token is valid OR the refresh path
   * succeeds (the cookies get rewritten as a side-effect). This stops the
   * "I look logged out but I'm not" UX where users reach /auth/login via a
   * stale URL and are forced to retype their password despite having a
   * working session.
   *
   * Mirrors the _authed.tsx routing rules so we land users where they'd
   * naturally end up after a fresh sign-in:
   *   - no tenant / onboarding not done → /onboarding
   *   - otherwise → /dashboard
   *
   * Wrapped in try/catch so any transient server-fn failure falls through
   * to rendering the login form rather than throwing on the way in.
   */
  beforeLoad: async () => {
    // Probe the session — if it fails (network blip, etc.), let the
    // login form render so the user can sign in normally. Only the
    // getCurrentUser call goes inside the try; the redirect MUST be
    // outside or the catch swallows it (TanStack Router's redirect()
    // throws an object the framework catches by reference, not by a
    // detectable property).
    let user: Awaited<ReturnType<typeof getCurrentUser>> | null = null
    try {
      user = await getCurrentUser()
    } catch {
      return
    }
    if (!user) return
    const onboardingDone = user.tenant?.onboardingCompleted ?? false
    throw redirect({ to: onboardingDone ? '/dashboard' : '/onboarding' })
  },
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
    mode: 'onTouched',
  })

  async function handleGoogleLogin() {
    setServerError(null)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setServerError(t('auth.errors.googleSignInFailed'))
    }
  }

  async function onSubmit(data: LoginFormData) {
    setServerError(null)
    setLoading(true)

    try {
      const supabase = createBrowserSupabase()
      const { data: authData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: data.email,
          password: data.password,
        })

      if (signInError) {
        if (signInError.message === 'Invalid login credentials') {
          // The most common reason "Invalid credentials" hits a real
          // user (not a bot) is that they originally signed up with
          // Google and don't actually have a password. Probe their
          // auth providers — if the only one is Google, redirect them
          // to the correct button instead of letting them spin on the
          // password field forever.
          try {
            const { googleOnly } = await checkLoginAuthMethod({
              data: { email: data.email },
            })
            setServerError(
              googleOnly
                ? t('auth.errors.googleOnlyAccount')
                : t('auth.errors.invalidCredentials'),
            )
          } catch {
            setServerError(t('auth.errors.invalidCredentials'))
          }
        } else if (signInError.message === 'Email not confirmed') {
          setServerError(t('auth.errors.emailNotConfirmed'))
        } else {
          setServerError(signInError.message)
        }
        return
      }

      // Set cookies for server-side auth. Both cookies share the same
      // Long-lived cookie so an expired access JWT can still travel to
      // the server, which falls through to refresh via sb-refresh-token.
      // (See the comment on setTokenCookies in hooks/use-auth.ts.)
      if (authData.session) {
        const sec = window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `sb-access-token=${authData.session.access_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
        document.cookie = `sb-refresh-token=${authData.session.refresh_token}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
      }

      navigate({ to: '/dashboard' })
    } catch {
      setServerError(t('auth.errors.generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800 dark:shadow-gray-900/50 lg:grid lg:grid-cols-2">
        {/* Left Panel — Branded illustration, full-bleed cover. The
            artwork is self-contained (headline, social proof, feature
            strip), so no overlays on top of it. */}
        <div className="relative hidden lg:block">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${loginHero})` }}
          />
        </div>

        {/* Right Panel — Form */}
        <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12">
          {/* Brand header — dark wordmark on light surface, white in dark mode */}
          <div className="mb-6">
            <img src={logoWordmark} alt="Vintra" className="h-8 w-auto dark:hidden" />
            <img
              src={logoWordmarkWhite}
              alt="Vintra"
              className="hidden h-8 w-auto dark:block"
            />
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t('auth.login.welcome')}
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t('auth.login.subWelcome')}
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div className="rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-500">
                {serverError}
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('auth.login.fieldEmail')}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="email"
                  type="email"
                  placeholder={t('auth.login.fieldEmailPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
                    errors.email
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600',
                  )}
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="mt-1.5 text-sm text-danger-500">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('auth.login.fieldPassword')}
                </label>
                <Link
                  to="/auth/forgot-password"
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  {t('auth.login.forgotPassword')}
                </Link>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth.login.fieldPasswordPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2.5 pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
                    errors.password
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600',
                  )}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-sm text-danger-500">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700"
                {...register('rememberMe')}
              />
              <label htmlFor="remember" className="text-sm text-gray-600 dark:text-gray-400">
                {t('auth.login.rememberMe')}
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? t('auth.login.submitLoading') : t('auth.login.submit')}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('auth.login.dividerOr')}</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Staff WhatsApp login. Routes to the slug-less landing
              (/auth/wa-login) which asks for the tenant code + phone,
              then forwards to the slug-specific page. Owners share
              the direct tenant URL (/auth/wa-login/{slug}) with staff
              normally; this button is the recovery path for staff who
              land on the main login page by mistake. */}
          <Link
            to="/auth/wa-login"
            className="mb-3 flex w-full items-center justify-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800 transition-colors hover:bg-green-100 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-300 dark:hover:bg-green-900/50"
          >
            <MessageCircle className="h-4 w-4" />
            Masuk dengan WhatsApp
          </Link>

          {/* Google Sign In */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {t('auth.login.googleSignIn')}
          </button>

          {/* Register link */}
          <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('auth.login.noAccount')}{' '}
            <Link
              to="/auth/register"
              className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              {t('auth.login.registerCta')}
            </Link>
          </p>
        </div>
      </div>

      {/* Floating help button */}
      <button
        type="button"
        className="fixed bottom-6 right-6 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700"
      >
        <HelpCircle className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        {t('auth.login.helpFloat')}
      </button>
    </div>
  )
}
