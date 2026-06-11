/**
 * Public article detail page (issue #206). Renders one published
 * article's sanitized HTML body + related articles.
 */
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import { getPublishedArticle } from '@/server/functions/articles'

const SITE_URL = 'https://vintra.my.id'

export const Route = createFileRoute('/artikel/$slug')({
  loader: async ({ params }) => {
    const data = await getPublishedArticle({ data: { slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const a = loaderData.article
    const title = a.seoTitle || a.title
    const description = a.seoDescription || a.excerpt || ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'article' },
        ...(a.coverImageKey
          ? [
              {
                property: 'og:image',
                content: `${SITE_URL}/artikel/media/${a.coverImageKey}`,
              },
            ]
          : []),
      ],
    }
  },
  component: ArtikelDetailPage,
})

function formatDate(value: string | Date | null): string {
  if (!value) return ''
  return new Date(value).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function ArtikelDetailPage() {
  const { t } = useTranslation()
  const { article, related } = Route.useLoaderData()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <LandingNavbar />
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-16 sm:px-6 lg:px-8">
        <Link
          to="/artikel"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" /> {t('artikel.backToList')}
        </Link>

        <article className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          {article.coverImageKey && (
            <img
              src={`/artikel/media/${article.coverImageKey}`}
              alt=""
              className="aspect-video w-full object-cover"
            />
          )}
          <div className="p-6 sm:p-10">
            {article.category && (
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                {article.category}
              </p>
            )}
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl dark:text-gray-100">
              {article.title}
            </h1>
            {article.publishedAt && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {formatDate(article.publishedAt)}
              </p>
            )}

            {/* Body — sanitized HTML produced server-side by the CMS. */}
            <div
              className="article-prose mt-8 text-gray-800 dark:text-gray-200"
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          </div>
        </article>

        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('artikel.related')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to="/artikel/$slug"
                  params={{ slug: r.slug }}
                  className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 hover:border-brand-400 dark:border-gray-700 dark:bg-gray-800"
                >
                  <span className="font-medium text-gray-900 group-hover:text-brand-700 dark:text-gray-100 dark:group-hover:text-brand-400">
                    {r.title}
                  </span>
                  {r.excerpt && (
                    <span className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                      {r.excerpt}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <LandingFooter />
    </div>
  )
}
