import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, Store, Mail, Lock, Eye, EyeOff, HelpCircle, CheckCircle2, Gift, Check as CheckIcon, X as XIcon } from 'lucide-react'
import i18n from '@/lib/i18n' // JUR-138: i18n.t in head()
import { createBrowserSupabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  registerFormSchema,
  type RegisterFormData,
} from '@/lib/schemas/register'
import { registerWithEmail, getCurrentUser } from '@/server/functions/auth'
import { validateReferralCode } from '@/server/functions/referrals-public'
import { SESSION_COOKIE_MAX_AGE } from '@/hooks/use-auth'
import {
  captureRefFromUrl,
  readRefCookie,
  clearRefCookie,
} from '@/lib/referral-cookie'
import registerHero from '@/assets/images/register-hero.png'
import logoWordmark from '@/assets/images/logo-wordmark.png'
import logoWordmarkWhite from '@/assets/images/logo-wordmark-white.png'

export const Route = createFileRoute('/auth/register')({
  head: () => ({
    meta: [
      { title: i18n.t('auth.register.metaTitle') },
      {
        name: 'description',
        content: i18n.t('auth.register.metaDescription'),
      },
    ],
  }),
  /**
   * Symmetric with /auth/login — if there's already a valid session,
   * skip the register form and bounce to the appropriate destination.
   * No reason for a signed-in user to land here.
   */
  beforeLoad: async () => {
    // Same shape as /auth/login — see that file for why the redirect
    // must live OUTSIDE the catch block.
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
  component: RegisterPage,
})

function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)

  // JUR-91: referral-code live-validation state. Three shapes:
  //   - { state: 'idle' } before the user touches the field
  //   - { state: 'checking' } while the server fn runs on blur
  //   - { state: 'valid', referrerName, discountPct } when the code resolves
  //   - { state: 'invalid' } when it doesn't (kept terse — not a real error)
  const [refState, setRefState] = useState<
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'valid'; referrerName: string; discountPct: string }
    | { state: 'invalid' }
    | { state: 'quota_full' }
  >({ state: 'idle' })

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      fullName: '',
      businessName: '',
      email: '',
      password: '',
      confirmPassword: '',
      referralCode: '',
    },
    mode: 'onTouched',
  })

  // On mount: capture ?ref= from the URL (writes the cookie) and
  // pre-fill the form field from whatever cookie value we have. Runs
  // after hydration so document.cookie / window.location are available.
  useEffect(() => {
    const captured = captureRefFromUrl() ?? readRefCookie()
    if (captured) {
      setValue('referralCode', captured)
      // Best-effort validation right away so the user sees the green
      // "kode valid" pill without having to click in the field.
      validateReferralCode({ data: { code: captured } })
        .then((res) => {
          if (res.valid) {
            setRefState({
              state: 'valid',
              referrerName: res.referrerName,
              discountPct: res.discountPct,
            })
          } else if (res.reason === 'quota_full') {
            setRefState({ state: 'quota_full' })
          } else {
            setRefState({ state: 'invalid' })
          }
        })
        .catch(() => setRefState({ state: 'idle' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleReferralBlur() {
    const raw = getValues('referralCode')?.trim()
    if (!raw) {
      setRefState({ state: 'idle' })
      return
    }
    setRefState({ state: 'checking' })
    try {
      const res = await validateReferralCode({ data: { code: raw } })
      if (res.valid) {
        setRefState({
          state: 'valid',
          referrerName: res.referrerName,
          discountPct: res.discountPct,
        })
      } else if (res.reason === 'quota_full') {
        setRefState({ state: 'quota_full' })
      } else {
        setRefState({ state: 'invalid' })
      }
    } catch {
      setRefState({ state: 'idle' })
    }
  }

  async function handleGoogleRegister() {
    setServerError(null)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setServerError(t('auth.errors.googleSignUpFailed'))
    }
  }

  async function onSubmit(data: RegisterFormData) {
    setServerError(null)
    setLoading(true)

    try {
      const result = await registerWithEmail({
        data: {
          email: data.email,
          password: data.password,
          fullName: data.fullName,
          businessName: data.businessName,
          // JUR-91: pass the referral code through. Server-side it's
          // optional and best-effort — invalid/inactive/self-referral
          // silently drop the attribution without blocking signup.
          referralCode: data.referralCode?.trim().toUpperCase() || undefined,
        },
      })

      // Attribution write happened (or no-op'd) inside registerWithEmail
      // — clear the cookie either way so a later re-visit doesn't try
      // to re-attribute. Idempotent for the no-cookie case.
      clearRefCookie()

      if (result.needsVerification) {
        setVerificationEmail(data.email)
        return
      }

      if (result.accessToken) {
        const supabase = createBrowserSupabase()
        await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken!,
        })
        // Long lifetime + Secure (in prod) — see hooks/use-auth.ts.
        const sec = window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `sb-access-token=${result.accessToken}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
        document.cookie = `sb-refresh-token=${result.refreshToken}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
      }

      navigate({ to: '/dashboard' })
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : t('auth.errors.generic'),
      )
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500'
  const normalBorder = 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800 dark:shadow-gray-900/50 lg:grid lg:grid-cols-2">
        {/* Left Panel — Branded illustration, full-bleed cover. The
            artwork is self-contained (headline, social proof, feature
            strip), so no overlays on top of it. */}
        <div className="relative hidden lg:block">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${registerHero})` }}
          />
        </div>

        {/* Right Panel — Form */}
        <div className="flex flex-col justify-center px-6 py-8 sm:px-10 lg:px-12">
          {/* Brand header — dark wordmark on light surface, white in dark mode */}
          <div className="mb-6">
            <img src={logoWordmark} alt="Vintra" className="h-8 w-auto dark:hidden" />
            <img
              src={logoWordmarkWhite}
              alt="Vintra"
              className="hidden h-8 w-auto dark:block"
            />
          </div>

          {verificationEmail ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/30">
                <CheckCircle2 className="h-8 w-8 text-brand-600 dark:text-brand-400" />
              </div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {t('auth.register.verifyTitle')}
              </h1>
              <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                {t('auth.register.verifySentTo')}
              </p>
              <p className="mb-6 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {verificationEmail}
              </p>
              <p className="mb-8 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                {t('auth.register.verifyInstructions')}
              </p>
              <Link
                to="/auth/login"
                className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                {t('auth.register.verifyGoToLogin')}
              </Link>
              <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
                {t('auth.register.verifyCheckSpam')}
              </p>
            </div>
          ) : (
          <>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t('auth.register.title')}
            </h1>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              {t('auth.register.subtitle')}
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-1">
            {serverError && (
              <div className="mb-3 rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-500">
                {serverError}
              </div>
            )}

            {/* Nama Lengkap */}
            <div className="relative pb-5">
              <label
                htmlFor="fullName"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('auth.register.fieldFullName')}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="fullName"
                  type="text"
                  placeholder={t('auth.register.fieldFullNamePlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2',
                    inputClass,
                    errors.fullName
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : normalBorder,
                  )}
                  {...register('fullName')}
                />
              </div>
              {errors.fullName && (
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {errors.fullName.message}
                </p>
              )}
            </div>

            {/* Nama Usaha */}
            <div className="relative pb-5">
              <label
                htmlFor="businessName"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('auth.register.fieldBusinessName')}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Store className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="businessName"
                  type="text"
                  placeholder={t('auth.register.fieldBusinessNamePlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2',
                    inputClass,
                    errors.businessName
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : normalBorder,
                  )}
                  {...register('businessName')}
                />
              </div>
              {errors.businessName && (
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {errors.businessName.message}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="relative pb-5">
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('auth.register.fieldEmail')}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="email"
                  type="email"
                  placeholder={t('auth.register.fieldEmailPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2',
                    inputClass,
                    errors.email
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : normalBorder,
                  )}
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="relative pb-5">
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('auth.register.fieldPassword')}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth.register.fieldPasswordPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2 pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2',
                    inputClass,
                    errors.password
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : normalBorder,
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
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Konfirmasi Password */}
            <div className="relative pb-5">
              <label
                htmlFor="confirmPassword"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('auth.register.fieldConfirmPassword')}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder={t('auth.register.fieldConfirmPasswordPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2 pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2',
                    inputClass,
                    errors.confirmPassword
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : normalBorder,
                  )}
                  {...register('confirmPassword')}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            {/* Kode Referral (opsional) — JUR-91 */}
            <div className="relative pb-5">
              <label
                htmlFor="referralCode"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('auth.register.fieldReferral')} <span className="text-xs font-normal text-gray-400">{t('auth.register.fieldReferralOptional')}</span>
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Gift className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="referralCode"
                  type="text"
                  placeholder={t('auth.register.fieldReferralPlaceholder')}
                  className={cn(
                    'w-full rounded-lg border py-2 pl-10 pr-10 text-sm uppercase outline-none transition-colors placeholder:text-gray-400 placeholder:normal-case focus:ring-2',
                    inputClass,
                    refState.state === 'valid'
                      ? 'border-success-500 focus:border-success-500 focus:ring-success-500/20'
                      : refState.state === 'invalid' || refState.state === 'quota_full'
                        ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                        : normalBorder,
                  )}
                  {...register('referralCode', {
                    onBlur: () => void handleReferralBlur(),
                  })}
                />
                {refState.state === 'valid' && (
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <CheckIcon className="h-4 w-4 text-success-500" />
                  </div>
                )}
                {(refState.state === 'invalid' || refState.state === 'quota_full') && (
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <XIcon className="h-4 w-4 text-danger-500" />
                  </div>
                )}
              </div>
              {refState.state === 'valid' && (
                <p className="absolute bottom-0 left-0 text-xs text-success-600 dark:text-success-400">
                  {t('auth.register.referralValid', {
                    pct: parseFloat(refState.discountPct).toFixed(0),
                    name: refState.referrerName || t('auth.register.referralValidFallbackName'),
                  })}
                </p>
              )}
              {refState.state === 'invalid' && (
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {t('auth.register.referralInvalid')}
                </p>
              )}
              {refState.state === 'quota_full' && (
                <p className="absolute bottom-0 left-0 text-xs text-danger-500">
                  {t('auth.register.referralQuotaFull')}
                </p>
              )}
              {refState.state === 'checking' && (
                <p className="absolute bottom-0 left-0 text-xs text-gray-400">{t('auth.register.referralChecking')}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? t('auth.register.submitLoading') : t('auth.register.submit')}
            </button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('auth.register.dividerOr')}</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          </div>

          {/* Google Sign Up */}
          <button
            type="button"
            onClick={handleGoogleRegister}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
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
            {t('auth.register.googleSignUp')}
          </button>

          {/* Login link */}
          <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('auth.register.haveAccount')}{' '}
            <Link
              to="/auth/login"
              className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              {t('auth.register.loginCta')}
            </Link>
          </p>
          </>
          )}
        </div>
      </div>

      {/* Floating help button */}
      <button
        type="button"
        className="fixed bottom-6 right-6 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700"
      >
        <HelpCircle className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        {t('auth.register.helpFloat')}
      </button>
    </div>
  )
}
