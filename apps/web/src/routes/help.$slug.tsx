/**
 * JUR-13: Help center article page. Renders one article + prev/next
 * nav + a "back to all articles" link. Body is JSX from the catalog
 * (not markdown) so links/components/syntax stay consistent without
 * a markdown parser dep.
 */
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { HELP_ARTICLES, getArticleBySlug } from '@/lib/help-articles'

export const Route = createFileRoute('/help/$slug')({
  // Validate the slug exists on the server side, but resolve the
  // article body on the client. The article object holds React
  // components (icon, JSX body) which TanStack Start's loader can't
  // serialize across the SSR boundary — so we let the loader only
  // 404-guard, and the component re-resolves from the same catalog.
  loader: ({ params }) => {
    const article = getArticleBySlug(params.slug)
    if (!article) throw notFound()
  },
  component: HelpArticlePage,
})

function HelpArticlePage() {
  const { t } = useTranslation()
  const params = Route.useParams()
  const article = getArticleBySlug(params.slug)
  if (!article) {
    // Should never hit this — the loader 404s first — but keep the
    // type narrowing happy.
    return null
  }
  const Icon = article.icon
  const idx = HELP_ARTICLES.findIndex((a) => a.slug === article.slug)
  const prev = idx > 0 ? HELP_ARTICLES[idx - 1] : null
  const next = idx < HELP_ARTICLES.length - 1 ? HELP_ARTICLES[idx + 1] : null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <LandingNavbar />
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
        <Link
          to="/help"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" /> {t('help.allArticles')}
        </Link>

        <article className="mt-6 rounded-xl border border-gray-200 bg-white p-6 sm:p-10 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
              <Icon className="h-5 w-5" />
            </div>
            <p className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" /> {t('help.minutesRead', { count: article.readMinutes })}
            </p>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-gray-100">
            {article.title}
          </h1>
          <p className="mt-2 text-base text-gray-600 dark:text-gray-400">
            {article.summary}
          </p>

          {/*
            Article body styling. We use plain Tailwind utilities + a few
            scoped overrides instead of @tailwindcss/typography to avoid
            adding a dep for one page. Headings, lists, and code blocks
            inherit from the article-prose class which has the right
            spacing + readable line-height tuned for Indonesian text.
          */}
          <div className="article-prose mt-8 text-gray-800 dark:text-gray-200">
            {article.body}
          </div>
        </article>

        <nav className="mt-8 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link
              to="/help/$slug"
              params={{ slug: prev.slug }}
              className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-400 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
            >
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <ArrowLeft className="h-3 w-3" /> {t('help.navPrevious')}
              </span>
              <span className="mt-1 font-medium text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-400">
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to="/help/$slug"
              params={{ slug: next.slug }}
              className="group flex flex-col items-end rounded-xl border border-gray-200 bg-white p-4 text-right hover:border-brand-400 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
            >
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                {t('help.navNext')} <ArrowRight className="h-3 w-3" />
              </span>
              <span className="mt-1 font-medium text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-400">
                {next.title}
              </span>
            </Link>
          ) : null}
        </nav>
      </main>
      <LandingFooter />
    </div>
  )
}
