/**
 * Public article / guide index (issue #206). Lists every published
 * article newest-first. Served on the landing layout so visitors can
 * read guides without signing in.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Newspaper } from 'lucide-react'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { listPublishedArticles } from '@/server/functions/articles'
import i18n from '@/lib/i18n'

export const Route = createFileRoute('/artikel/')({
  loader: () => listPublishedArticles(),
  head: () => ({
    meta: [
      { title: i18n.t('artikel.metaTitle') },
      { name: 'description', content: i18n.t('artikel.metaDescription') },
    ],
  }),
  component: ArtikelIndexPage,
})

function formatDate(value: string | Date | null): string {
  if (!value) return ''
  return new Date(value).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function ArtikelIndexPage() {
  const { t } = useTranslation()
  const articles = Route.useLoaderData()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <LandingNavbar />
      <main className="mx-auto max-w-5xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
            {t('artikel.title')}
          </h1>
          <p className="mt-3 text-base text-gray-600 dark:text-gray-400">
            {t('artikel.subtitle')}
          </p>
        </div>

        {articles.length === 0 ? (
          <div className="mt-12 flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800">
            <Newspaper className="h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('artikel.empty')}
            </p>
          </div>
        ) : (
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((a) => (
              <Link
                key={a.slug}
                to="/artikel/$slug"
                params={{ slug: a.slug }}
                className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-colors hover:border-brand-400 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="aspect-video w-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                  {a.coverImageKey ? (
                    <img
                      src={`/artikel/media/${a.coverImageKey}`}
                      alt=""
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-300 dark:text-gray-600">
                      <Newspaper className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                    {a.category || t('artikel.uncategorized')}
                  </p>
                  <h2 className="mt-1.5 font-semibold text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-400">
                    {a.title}
                  </h2>
                  {a.excerpt && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                      {a.excerpt}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-gray-400">
                    {formatDate(a.publishedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <LandingFooter />
    </div>
  )
}
