/**
 * JUR-13: Help center index. Lists all articles grouped by category.
 * Public route — no auth required, served on the landing layout so a
 * visitor evaluating the platform can read the docs without signing up.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { HELP_ARTICLES, CATEGORY_LABELS } from '@/lib/help-articles'
import i18n from '@/lib/i18n' // JUR-138

export const Route = createFileRoute('/help/')({
  head: () => ({
    meta: [
      { title: i18n.t('help.metaTitle') },
      {
        name: 'description',
        content: i18n.t('help.metaDescription'),
      },
    ],
  }),
  component: HelpIndexPage,
})

function HelpIndexPage() {
  const { t } = useTranslation()
  // Group articles by category, preserving the order they appear in
  // HELP_ARTICLES so curated sequencing (e.g. mulai → kasir →
  // inventaris) stays intentional.
  const grouped = new Map<string, typeof HELP_ARTICLES>()
  for (const a of HELP_ARTICLES) {
    const list = grouped.get(a.category) ?? []
    list.push(a)
    grouped.set(a.category, list)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <LandingNavbar />
      <main className="mx-auto max-w-5xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
            {t('help.title')}
          </h1>
          <p className="mt-3 text-base text-gray-600 dark:text-gray-400">
            {t('help.subtitle')}
          </p>
        </div>

        <div className="mt-12 space-y-10">
          {Array.from(grouped.entries()).map(([cat, articles]) => (
            <section key={cat}>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS]}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {articles.map((a) => {
                  const Icon = a.icon
                  return (
                    <li key={a.slug}>
                      <Link
                        to="/help/$slug"
                        params={{ slug: a.slug }}
                        className="group flex h-full gap-4 rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-brand-400 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-400">
                            {a.title}
                          </h3>
                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            {a.summary}
                          </p>
                          <p className="mt-2 text-xs text-gray-400">
                            {t('help.minutesRead', { count: a.readMinutes })}
                          </p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
