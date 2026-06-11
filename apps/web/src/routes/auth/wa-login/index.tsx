/**
 * Slug-less WhatsApp login landing — the fallback entry for staff who
 * navigated to /auth/login by accident and don't have the tenant-
 * specific URL their owner shared. Asks for two things:
 *
 *   - Tenant slug (e.g. "warung-kopi-budi") — the short identifier
 *     in the URL the owner copied from /settings/members. This is
 *     short, memorable, and printable.
 *   - WA phone — same field as the slug-specific page.
 *
 * On submit we redirect to /auth/wa-login/{slug}?phone={normalized}.
 * The slug page reads the phone search param, pre-fills its form, and
 * auto-fires the OTP request so the user only types the slug here and
 * the phone, never twice.
 *
 * Deliberately does NOT call any API to validate the slug — that
 * would leak which slugs exist on the platform. A bad slug surfaces
 * as the same generic "wa_login_unavailable" error the slug page
 * shows for "WA login disabled" / "feature not paid" / etc.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, HelpCircle, MessageCircle, Phone, Store } from 'lucide-react'

import i18n from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { getCurrentUser } from '@/server/functions/auth'
import { phoneInput } from '@vintra/shared'
import logo from '@/assets/images/logo.png'
import logoWithTextWhite from '@/assets/images/logo-with-text-white.png'
import loginCover from '@/assets/images/login-cover.png'

// Tenant slugs in this codebase are auto-generated kebab-case
// identifiers — letters, digits, dashes. Keeping the regex loose
// (no length floor / ceiling) so we don't accidentally reject a real
// slug; the slug page rejects unknown ones with the same generic
// error anyway.
const tenantSlugRule = z
  .string()
  .min(1, 'Kode toko wajib diisi')
  .regex(/^[a-z0-9-]+$/i, 'Kode toko hanya boleh huruf, angka, dan tanda hubung')

const formSchema = z.object({
  tenantSlug: tenantSlugRule.transform((s) => s.toLowerCase().trim()),
  phone: phoneInput,
})
type FormData = z.input<typeof formSchema>

export const Route = createFileRoute('/auth/wa-login/')({
  head: () => ({
    meta: [
      { title: i18n.t('auth.login.metaTitle') },
      {
        name: 'description',
        content: 'Login Karyawan via WhatsApp ke Vintra',
      },
    ],
  }),
  // Mirror the slug-page beforeLoad — if a returning user has a live
  // session, bypass the form and send them straight to /dashboard.
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
  component: WaLoginLanding,
})

function WaLoginLanding() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { tenantSlug: '', phone: '' },
    mode: 'onTouched',
  })

  async function onSubmit(data: FormData) {
    setServerError(null)
    try {
      // Re-parse to get the normalized + transformed output (lowercase
      // slug, E.164 phone). Both are safe to embed in URL — slug is
      // already URL-safe by regex, phone is digits only.
      const parsed = formSchema.parse(data)
      navigate({
        to: '/auth/wa-login/$tenantSlug',
        params: { tenantSlug: parsed.tenantSlug },
        search: { phone: parsed.phone },
      })
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800 dark:shadow-gray-900/50 lg:grid lg:grid-cols-2">
        {/* Left Panel — same branded look as the slug page */}
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
                Masukkan kode toko dari pemilik usaha dan nomor WhatsApp Anda
                untuk lanjut.
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

          <a
            href="/auth/login"
            className="mb-4 flex items-center gap-1.5 self-start text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke login utama
          </a>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Login dengan WhatsApp
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Tanyakan <span className="font-medium">kode toko</span> ke pemilik
              usaha Anda — biasanya nama toko dalam format
              <span className="font-mono"> seperti-ini</span>.
            </p>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {serverError && (
              <div className="rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-500">
                {serverError}
              </div>
            )}

            <div>
              <label htmlFor="tenantSlug" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Kode Toko
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Store className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                </div>
                <input
                  id="tenantSlug"
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="warung-kopi-budi"
                  className={cn(
                    'w-full rounded-lg border py-2.5 pl-10 pr-3 font-mono text-sm outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500',
                    form.formState.errors.tenantSlug
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600',
                  )}
                  {...form.register('tenantSlug')}
                />
              </div>
              {form.formState.errors.tenantSlug && (
                <p className="mt-1.5 text-sm text-danger-500">
                  {form.formState.errors.tenantSlug.message}
                </p>
              )}
            </div>

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
                    form.formState.errors.phone
                      ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                      : 'border-gray-300 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-600',
                  )}
                  {...form.register('phone')}
                />
              </div>
              {form.formState.errors.phone && (
                <p className="mt-1.5 text-sm text-danger-500">
                  {form.formState.errors.phone.message}
                </p>
              )}
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Format: 08xx, +62 8xx, atau 628xx — semuanya diterima.
              </p>
            </div>

            <button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {form.formState.isSubmitting ? 'Memproses…' : 'Lanjutkan'}
            </button>
          </form>

          <div className="mt-8 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-300">
            <MessageCircle className="h-4 w-4 shrink-0" />
            <span>
              Belum tahu kode toko? Tanyakan ke pemilik usaha Anda — mereka
              bisa lihat di halaman <span className="font-medium">Anggota Tim</span>.
            </span>
          </div>
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
