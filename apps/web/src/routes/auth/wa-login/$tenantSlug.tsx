/**
 * Staff WhatsApp OTP login page (PR 5 of the wa-login series).
 *
 * Two-step state machine:
 *
 *   step = 'phone'  — user enters their WA number. Submit calls
 *                     requestWaLoginOtp() which returns the wa.me deep
 *                     link for the tenant's WhatsApp instance.
 *   step = 'verify' — page shows the deep link as a primary CTA, plus
 *                     a 6-digit OTP input. The user clicks the link,
 *                     sends "Minta OTP Login Vintra" (or anything
 *                     matching the trigger), receives the code in
 *                     WhatsApp, types it back, hits verify.
 *
 * On verify success the server fn returns Supabase session tokens; we
 * set sb-access-token / sb-refresh-token cookies and tell the browser-
 * side supabase client about the new session (mirrors the email/
 * password path in /auth/login). Then navigate to /dashboard.
 *
 * No tenant pre-validation at loader — that needs a phone, and the
 * /request endpoint is the source of truth anyway. A bad slug surfaces
 * as the generic "wa_login_unavailable" error on first submit.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Phone,
} from 'lucide-react'

import i18n from '@/lib/i18n'
import { createBrowserSupabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { SESSION_COOKIE_MAX_AGE } from '@/hooks/use-auth'
import { getCurrentUser } from '@/server/functions/auth'
import {
  requestWaLoginOtp,
  verifyWaLoginOtp,
} from '@/server/functions/wa-login'
import { phoneInput, otpCode } from '@vintra/shared'
import logo from '@/assets/images/logo.png'
import logoWithTextWhite from '@/assets/images/logo-with-text-white.png'
import loginCover from '@/assets/images/login-cover.png'

// Form schemas — scoped to this page so the error messages can match
// the WA-login UX exactly. The shared phoneInput/otpCode validators
// already speak Bahasa Indonesia.
const phoneFormSchema = z.object({ phone: phoneInput })
const otpFormSchema = z.object({ otp: otpCode })
type PhoneFormData = z.input<typeof phoneFormSchema>
type OtpFormData = z.input<typeof otpFormSchema>

const OTP_TTL_SEC = 5 * 60 // mirrors apps/api/internal/walogin.OtpTTL

// Optional `?phone=` carry-over from the slug-less landing
// (/auth/wa-login). When present and parseable, the page pre-fills
// the phone input and auto-fires the OTP request so the user doesn't
// retype. Strict regex — only the canonical "62XXXXXXXXXX" form is
// accepted, which is what the landing-page Zod transform produces.
const searchSchema = z.object({
  phone: z.string().regex(/^62\d{8,12}$/).optional(),
})

export const Route = createFileRoute('/auth/wa-login/$tenantSlug')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: i18n.t('auth.login.metaTitle') },
      {
        name: 'description',
        content: 'Login dengan WhatsApp ke Vintra',
      },
    ],
  }),
  // Skip the form if there's already a valid session — same logic as
  // /auth/login, kept here so a returning user hitting the bookmarked
  // tenant URL doesn't see a login form they don't need.
  beforeLoad: async () => {
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
  component: WaLoginPage,
})

type RequestResult = {
  instancePhone: string
  deepLink: string
  tenantName: string
  expectedReplyWithinSec: number
}

type Step = 'phone' | 'verify'

function WaLoginPage() {
  const { tenantSlug } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [serverError, setServerError] = useState<string | null>(null)
  const [requestResult, setRequestResult] = useState<RequestResult | null>(null)
  const [normalizedPhone, setNormalizedPhone] = useState<string>('')

  const phoneForm = useForm<PhoneFormData>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: { phone: search.phone ?? '' },
    mode: 'onTouched',
  })

  // If the user arrived from /auth/wa-login with `?phone=`, auto-fire
  // the OTP request once on mount. Ref-guarded so a re-render (state
  // change, HMR) doesn't trigger a second request. We still render the
  // phone step briefly while the request is in-flight; the page
  // transitions to step='verify' as soon as it resolves.
  const autoFiredRef = useRef(false)

  const otpForm = useForm<OtpFormData>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { otp: '' },
    mode: 'onTouched',
  })

  async function onPhoneSubmit(data: PhoneFormData) {
    setServerError(null)
    try {
      // Zod transforms `phone` from raw to normalized. The `data` here
      // is the input type so we re-normalize via parse to get the
      // string we'll later send to verify.
      const parsed = phoneFormSchema.parse(data)
      const result = await requestWaLoginOtp({
        data: { tenantSlug, phone: parsed.phone },
      })
      setRequestResult(result as RequestResult)
      setNormalizedPhone(parsed.phone)
      setStep('verify')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setServerError(translateApiError(msg))
    }
  }

  useEffect(() => {
    if (autoFiredRef.current) return
    if (!search.phone) return
    autoFiredRef.current = true
    // Submit through the form so validation runs identically to the
    // manual path. The form's defaultValue already has the phone.
    phoneForm.handleSubmit(onPhoneSubmit)()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.phone])

  async function onOtpSubmit(data: OtpFormData) {
    setServerError(null)
    try {
      const parsed = otpFormSchema.parse(data)
      const result = await verifyWaLoginOtp({
        data: {
          tenantSlug,
          phone: normalizedPhone,
          otp: parsed.otp,
        },
      })

      // Cookies for SSR auth (mirrors the email/password flow in
      // routes/auth/login.tsx — see comments there on why both cookies
      // share the same long-lived max-age).
      const sec = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `sb-access-token=${result.accessToken}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`
      document.cookie = `sb-refresh-token=${result.refreshToken}; path=/; max-age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax${sec}`

      // Sync the browser-side supabase client so it knows about the
      // session for future signOut() / refresh() calls.
      const supabase = createBrowserSupabase()
      await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      })

      navigate({ to: '/dashboard' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setServerError(translateApiError(msg))
    }
  }

  function handleBack() {
    setStep('phone')
    setServerError(null)
    setRequestResult(null)
    otpForm.reset({ otp: '' })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800 dark:shadow-gray-900/50 lg:grid lg:grid-cols-2">
        {/* Left Panel — Branded (mirrors /auth/login for visual consistency) */}
        <div className="relative hidden lg:block">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${loginCover})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
          <div className="relative flex h-full flex-col justify-between p-10">
            <img
              src={logoWithTextWhite}
              alt="Vintra — All-in-one tools. Grow your business."
              className="h-12 w-auto self-start"
            />
            <div className="space-y-4">
              <h2 className="text-3xl font-bold leading-tight text-white">
                Login Karyawan{'\n'}lewat WhatsApp
              </h2>
              <p className="text-sm leading-relaxed text-gray-300">
                Tidak perlu ingat email atau password. Cukup kirim pesan
                ke WhatsApp toko Anda untuk dapatkan kode login.
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel — Form */}
        <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <img src={logo} alt="Vintra" className="h-8 w-8" />
            <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Vintra</span>
          </div>

          {step === 'phone' ? (
            <PhoneStep
              form={phoneForm}
              loading={phoneForm.formState.isSubmitting}
              serverError={serverError}
              onSubmit={onPhoneSubmit}
            />
          ) : requestResult ? (
            <VerifyStep
              form={otpForm}
              loading={otpForm.formState.isSubmitting}
              serverError={serverError}
              requestResult={requestResult}
              onSubmit={onOtpSubmit}
              onBack={handleBack}
            />
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="fixed bottom-6 right-6 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-gray-200 transition-colors hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700"
      >
        <HelpCircle className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        Butuh bantuan?
      </button>
    </div>
  )
}

function PhoneStep({
  form,
  loading,
  serverError,
  onSubmit,
}: {
  form: ReturnType<typeof useForm<PhoneFormData>>
  loading: boolean
  serverError: string | null
  onSubmit: (data: PhoneFormData) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Login dengan WhatsApp
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Masukkan nomor WhatsApp Anda yang terdaftar di toko ini.
          Kami akan kirim kode login lewat WhatsApp.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {serverError && (
          <div className="rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-500">
            {serverError}
          </div>
        )}

        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Nomor WhatsApp
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Phone className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            </div>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              inputMode="numeric"
              placeholder="08123456789"
              className={cn(
                'w-full rounded-lg border py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
                errors.phone
                  ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                  : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600',
              )}
              {...register('phone')}
            />
          </div>
          {errors.phone && (
            <p className="mt-1.5 text-sm text-danger-500">
              {errors.phone.message}
            </p>
          )}
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Format: 08xx, +62 8xx, atau 628xx — semuanya diterima.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Memproses…' : 'Lanjutkan'}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Mau login dengan email?{' '}
        <a
          href="/auth/login"
          className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          Halaman login utama
        </a>
      </p>
    </>
  )
}

function VerifyStep({
  form,
  loading,
  serverError,
  requestResult,
  onSubmit,
  onBack,
}: {
  form: ReturnType<typeof useForm<OtpFormData>>
  loading: boolean
  serverError: string | null
  requestResult: RequestResult
  onSubmit: (data: OtpFormData) => void
  onBack: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form

  const [secondsLeft, setSecondsLeft] = useState(OTP_TTL_SEC)
  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secondsLeft])

  const expired = secondsLeft <= 0
  const mm = Math.floor(secondsLeft / 60)
  const ss = secondsLeft % 60

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 self-start text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Ubah nomor
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Kirim pesan ke {requestResult.tenantName}
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Klik tombol di bawah untuk membuka WhatsApp dan kirim pesan.
          Sistem akan membalas dengan kode login Anda dalam ~{requestResult.expectedReplyWithinSec} detik.
        </p>
      </div>

      <a
        href={requestResult.deepLink}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1ebe5b]"
      >
        Buka WhatsApp
        <ExternalLink className="h-4 w-4" />
      </a>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {serverError && (
          <div className="rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-500">
            {serverError}
          </div>
        )}

        <div>
          <label htmlFor="otp" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Kode OTP (6 digit)
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <KeyRound className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            </div>
            <input
              id="otp"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              className={cn(
                'w-full rounded-lg border py-2.5 pl-10 pr-3 text-base tracking-[0.5em] outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
                errors.otp
                  ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                  : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600',
              )}
              {...register('otp')}
            />
          </div>
          {errors.otp && (
            <p className="mt-1.5 text-sm text-danger-500">
              {errors.otp.message}
            </p>
          )}
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {expired ? (
              <span className="text-danger-500">
                Kode sudah kadaluarsa. Kirim pesan ulang untuk dapat kode baru.
              </span>
            ) : (
              <>
                Berlaku{' '}
                <span className="font-medium tabular-nums">
                  {mm}:{ss.toString().padStart(2, '0')}
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || expired}
          className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Memverifikasi…' : 'Verifikasi & Masuk'}
        </button>
      </form>
    </>
  )
}

/**
 * Map api error keys to UI-friendly Indonesian messages. Both endpoints
 * return short generic codes ("otp_invalid", "wa_login_unavailable",
 * "rate_limited") — never reveal which case occurred.
 */
function translateApiError(msg: string): string {
  if (msg.includes('otp_invalid')) {
    return 'Kode salah atau sudah kadaluarsa. Coba lagi atau kirim pesan ulang.'
  }
  if (msg.includes('otp_too_many_attempts')) {
    return 'Terlalu banyak percobaan. Kirim pesan ulang untuk dapat kode baru.'
  }
  if (msg.includes('wa_login_unavailable')) {
    return 'Login WhatsApp belum aktif untuk toko ini. Hubungi pemilik usaha.'
  }
  if (msg.includes('rate_limited')) {
    return 'Terlalu banyak permintaan. Coba lagi dalam 1 jam.'
  }
  if (msg.toLowerCase().includes('phone')) {
    return 'Format nomor HP tidak dikenali.'
  }
  return 'Terjadi kesalahan. Coba lagi.'
}
