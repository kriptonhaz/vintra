import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { MessageSquare, ChevronRight, Globe2 } from 'lucide-react'
import { listAdminFeedbackThreads } from '@/server/functions/admin-feedback'
import { Input } from '@/components/ui/input'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

const searchSchema = z.object({
  status: z.enum(['open', 'replied', 'resolved', 'all']).default('all'),
  source: z.enum(['in_app', 'public', 'all']).default('all'),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export const Route = createFileRoute('/admin/feedback/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listAdminFeedbackThreads({
      data: {
        status: deps.status,
        source: deps.source,
        search: deps.search,
        page: deps.page,
      },
    }),
  component: AdminFeedbackPage,
})

const STATUS_LABEL: Record<string, string> = {
  open: 'Menunggu',
  replied: 'Dibalas',
  resolved: 'Selesai',
}
const STATUS_CLASS: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  replied: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  resolved: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

function AdminFeedbackPage() {
  const threads = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()

  function updateSearch(patch: Partial<typeof search>) {
    void router.navigate({ search: { ...search, ...patch, page: 1 } as never })
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Feedback Inbox</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Cari subjek / tenant..."
          value={search.search ?? ''}
          onChange={(e) => updateSearch({ search: e.target.value || undefined })}
          className="w-56"
        />
        <select
          value={search.status}
          onChange={(e) => updateSearch({ status: e.target.value as typeof search.status })}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="all">Semua Status</option>
          <option value="open">Menunggu</option>
          <option value="replied">Dibalas</option>
          <option value="resolved">Selesai</option>
        </select>
        <select
          value={search.source}
          onChange={(e) => updateSearch({ source: e.target.value as typeof search.source })}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="all">Semua Sumber</option>
          <option value="in_app">In-App</option>
          <option value="public">Publik</option>
        </select>
      </div>

      {/* Thread list */}
      {threads.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <MessageSquare className="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-500">Tidak ada feedback.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
          {threads.map((t) => (
            <Link
              key={t.id}
              to="/admin/feedback/$threadId"
              params={{ threadId: t.id }}
              className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-gray-900 dark:text-gray-100">{t.subject}</p>
                  {t.source === 'public' && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                      <Globe2 className="h-3 w-3" /> Publik
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-400">
                  {t.tenantName ?? 'Tamu'} ·{' '}
                  {formatDistanceToNow(new Date(t.lastMessageAt), {
                    addSuffix: true,
                    locale: idLocale,
                  })}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[t.status] ?? STATUS_CLASS.open}`}>
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
