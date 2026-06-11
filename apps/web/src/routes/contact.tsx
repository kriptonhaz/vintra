/**
 * JUR-148: Public /contact landing page. Unauthenticated submission
 * endpoint backed by `feedback_threads` with source='public'. Admin
 * replies route through Brevo email to the submitter's address.
 *
 * Defenses against spam:
 *  - Honeypot "website" field (silently dropped if filled)
 *  - Cloudflare Turnstile (conditional on VITE_TURNSTILE_SITE_KEY)
 *  - Per-IP rate limit (5/hour, enforced in submitPublicFeedback)
 *  - Email format validation (Zod)
 */
import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CheckCircle2, Mail, MessageCircle } from 'lucide-react'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { submitPublicFeedback } from '@/server/functions/feedback'
import i18n from '@/lib/i18n'

export const Route = createFileRoute('/contact')({
  head: () => ({
    meta: [
      { title: i18n.t('contact.metaTitle') },
      { name: 'description', content: i18n.t('contact.metaDescription') },
    ],
  }),
  component: ContactPage,
})

const contactFormSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  email: z.string().trim().email('Email tidak valid').max(254),
  subject: z.string().trim().min(1, 'Subjek wajib diisi').max(200),
  body: z.string().trim().min(10, 'Pesan minimal 10 karakter').max(5000),
  // Honeypot. Real users leave this blank; bots that auto-fill every
  // input get caught and silently dropped server-side.
  website: z.string().max(0).optional().or(z.literal('')),
})
type ContactFormValues = z.infer<typeof contactFormSchema>

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
        },
      ) => string
      reset: (widgetId?: string) => void
    }
  }
}

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/**
 * Loads the Turnstile script once (deduped) and renders the widget in
 * the provided container. Calls `onToken` whenever Cloudflare hands us
 * a fresh token. Returns a reset function so the parent can clear the
 * widget after a successful submission.
 */
function useTurnstile(
  containerRef: React.RefObject<HTMLDivElement | null>,
  siteKey: string | undefined,
  onToken: (token: string) => void,
): () => void {
  const widgetIdRef = useRef<string | null>(null)
  const renderedRef = useRef(false)

  useEffect(() => {
    if (!siteKey || !containerRef.current) return
    if (renderedRef.current) return

    function renderWidget() {
      if (!window.turnstile || !containerRef.current || renderedRef.current) return
      renderedRef.current = true
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey!,
        theme: 'light',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      })
    }

    if (window.turnstile) {
      renderWidget()
      return
    }

    const existing = document.querySelector(
      `script[src^="${TURNSTILE_SCRIPT_SRC}"]`,
    )
    if (existing) {
      existing.addEventListener('load', renderWidget, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = renderWidget
    document.head.appendChild(script)
  }, [siteKey, containerRef, onToken])

  return () => {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current)
    }
  }
}

function ContactPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string>('')
  const turnstileRef = useRef<HTMLDivElement | null>(null)

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
  const captchaConfigured = Boolean(siteKey)

  const resetTurnstile = useTurnstile(turnstileRef, siteKey, setTurnstileToken)

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { name: '', email: '', subject: '', body: '', website: '' },
  })

  async function onSubmit(values: ContactFormValues) {
    setServerError(null)
    if (captchaConfigured && !turnstileToken) {
      setServerError(t('contact.errorCaptchaRequired'))
      return
    }
    try {
      await submitPublicFeedback({
        data: {
          name: values.name,
          email: values.email,
          subject: values.subject,
          body: values.body,
          website: values.website ?? '',
          turnstileToken: turnstileToken || undefined,
        },
      })
      setDone(true)
      resetTurnstile()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('contact.errorGeneric')
      setServerError(msg)
      toast({
        title: t('contact.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
      resetTurnstile()
      setTurnstileToken('')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <LandingNavbar />
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
            {t('contact.hero.eyebrow')}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
            {t('contact.hero.title')}
          </h1>
          <p className="mt-3 text-base text-gray-600 dark:text-gray-400">
            {t('contact.hero.subtitle')}
          </p>
        </div>

        {done ? (
          <div className="mt-10 rounded-2xl border border-success-200 bg-success-50 p-8 text-center dark:border-success-800 dark:bg-success-900/20">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success-600 dark:text-success-400" />
            <h2 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('contact.success.title')}
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t('contact.success.body')}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t('contact.success.ctaHome')}
              </Link>
              <Link
                to="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                {t('contact.success.ctaPricing')} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="mt-10 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-8"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="contact-name"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('contact.field.name')}
                </label>
                <Input
                  id="contact-name"
                  {...form.register('name')}
                  placeholder={t('contact.field.namePlaceholder')}
                  autoComplete="name"
                />
                {form.formState.errors.name && (
                  <p className="mt-1 text-xs text-danger-600">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="contact-email"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('contact.field.email')}
                </label>
                <Input
                  id="contact-email"
                  type="email"
                  {...form.register('email')}
                  placeholder={t('contact.field.emailPlaceholder')}
                  autoComplete="email"
                />
                {form.formState.errors.email && (
                  <p className="mt-1 text-xs text-danger-600">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5">
              <label
                htmlFor="contact-subject"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('contact.field.subject')}
              </label>
              <Input
                id="contact-subject"
                {...form.register('subject')}
                placeholder={t('contact.field.subjectPlaceholder')}
              />
              {form.formState.errors.subject && (
                <p className="mt-1 text-xs text-danger-600">
                  {form.formState.errors.subject.message}
                </p>
              )}
            </div>

            <div className="mt-5">
              <label
                htmlFor="contact-body"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t('contact.field.body')}
              </label>
              <Textarea
                id="contact-body"
                rows={6}
                {...form.register('body')}
                placeholder={t('contact.field.bodyPlaceholder')}
              />
              {form.formState.errors.body && (
                <p className="mt-1 text-xs text-danger-600">
                  {form.formState.errors.body.message}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {t('contact.field.bodyHint')}
              </p>
            </div>

            {/* Honeypot — hidden from real users via inline style. The
                aria-hidden + tabIndex={-1} + autocomplete=off triple
                ensures keyboard + screen reader users skip it entirely. */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: '-10000px',
                top: 'auto',
                width: '1px',
                height: '1px',
                overflow: 'hidden',
              }}
            >
              <label htmlFor="contact-website">Website</label>
              <input
                id="contact-website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                {...form.register('website')}
              />
            </div>

            {captchaConfigured && (
              <div className="mt-5">
                <div ref={turnstileRef} />
              </div>
            )}

            {serverError && (
              <p className="mt-4 text-sm text-danger-600">{serverError}</p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                type="submit"
                variant="brand"
                loading={form.formState.isSubmitting}
              >
                <Mail className="mr-2 h-4 w-4" />
                {t('contact.submit')}
              </Button>
            </div>

            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              {t('contact.disclaimer')}
            </p>
          </form>
        )}

        <div className="mt-12 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('contact.altChannel.prefix')}{' '}
            <a
              href="mailto:support@vintra.my.id"
              className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              support@vintra.my.id
            </a>{' '}
            <MessageCircle className="inline h-3.5 w-3.5 text-gray-400" />
          </p>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
