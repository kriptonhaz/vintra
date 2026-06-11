/**
 * Admin article list (issue #206). Platform-global guide / blog
 * articles authored here and published to /artikel.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus, Newspaper, Eye } from 'lucide-react'
import { listArticlesAdmin } from '@/server/functions/articles'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

export const Route = createFileRoute('/admin/articles/')({
  loader: () => listArticlesAdmin(),
  component: ArticlesListPage,
})

const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'outline' },
  published: { label: 'Terbit', variant: 'success' },
  archived: { label: 'Arsip', variant: 'warning' },
}

function formatDate(value: string | Date | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function ArticlesListPage() {
  const articles = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Artikel & Panduan
          </h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Kelola artikel panduan yang tampil di halaman publik /artikel.
          </p>
        </div>
        <Button variant="brand" asChild>
          <Link to="/admin/articles/$articleId" params={{ articleId: 'new' }}>
            <Plus className="h-4 w-4" /> Buat Artikel
          </Link>
        </Button>
      </div>

      {articles.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <EmptyState
            icon={<Newspaper className="h-6 w-6" />}
            title="Belum ada artikel"
            description="Buat artikel pertama untuk memandu pengguna Vintra."
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {articles.map((a) => {
              const meta = STATUS_META[a.status] ?? STATUS_META.draft!
              return (
                <li key={a.id}>
                  <Link
                    to="/admin/articles/$articleId"
                    params={{ articleId: a.id }}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
                      {a.coverImageKey && (
                        <img
                          src={`/artikel/media/${a.coverImageKey}`}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {a.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                        {a.category || 'Tanpa kategori'} · diperbarui{' '}
                        {formatDate(a.updatedAt)}
                      </p>
                    </div>
                    <span className="hidden items-center gap-1 text-xs text-gray-400 sm:inline-flex">
                      <Eye className="h-3.5 w-3.5" /> {a.viewCount}
                    </span>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
