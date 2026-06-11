import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { CheckCircle2, ArrowLeft, Mail } from 'lucide-react'
import { sendPasswordResetEmail } from '@/server/functions/auth'
import logoWordmark from '@/assets/images/logo-wordmark.png'
import logoWordmarkWhite from '@/assets/images/logo-wordmark-white.png'

export const Route = createFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Routed through our Brevo pipeline instead of
      // supabase.auth.resetPasswordForEmail(). Supabase's hosted SMTP
      // has been rate-limited in this project (same root cause as the
      // "Error sending confirmation email" issue on signup). The
      // server fn is anti-enumeration: it always succeeds, even for
      // emails that aren't registered.
      await sendPasswordResetEmail({ data: { email } })
      setSent(true)
    } catch {
      setError(t('auth.errors.generic'))
    } finally {
      setLoading(false)
    }
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
            {t('auth.forgotPassword.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('auth.forgotPassword.subtitle')}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-8">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-500/20">
                <CheckCircle2 className="h-6 w-6 text-brand-600 dark:text-brand-400" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
                {t('auth.forgotPassword.sentTitle')}
              </h3>
              <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
                {/* JUR-138: Trans interprets <strong> + interpolates {{email}} */}
                <Trans
                  i18nKey="auth.forgotPassword.sentBody"
                  values={{ email }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <a
                href="/auth/login"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('auth.forgotPassword.backToLogin')}
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-lg bg-danger-500/10 px-4 py-3 text-sm text-danger-600 dark:text-danger-400">
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('auth.forgotPassword.fieldEmail')}
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Mail className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.forgotPassword.fieldEmailPlaceholder')}
                    required
                    className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {loading
                  ? t('auth.forgotPassword.submitLoading')
                  : t('auth.forgotPassword.submit')}
              </button>

              <div className="text-center text-sm text-gray-600 dark:text-gray-400">
                {t('auth.forgotPassword.rememberPassword')}{' '}
                <a
                  href="/auth/login"
                  className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  {t('auth.forgotPassword.loginCta')}
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
