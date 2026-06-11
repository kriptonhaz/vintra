import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  listMyAttributions,
  listMyReferralCodes,
} from '@/server/functions/referrals'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'

const PAGE_SIZE = 25

// Search params drive the page state — pagination + filters live in
// the URL so refresh, back button, and shared links all work. Empty
// values are encoded as `undefined` so the URL stays clean.
const searchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().optional(),
  codeId: z.string().uuid().optional(),
  status: z.enum(['paid', 'unpaid']).optional(),
})

export const Route = createFileRoute('/_authed/referrals/pendaftar')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page,
    q: search.q,
    codeId: search.codeId,
    status: search.status,
  }),
  loader: async ({ deps }) => {
    const [attributions, codes] = await Promise.all([
      listMyAttributions({
        data: {
          page: deps.page,
          pageSize: PAGE_SIZE,
          search: deps.q,
          codeId: deps.codeId,
          status: deps.status,
        },
      }),
      listMyReferralCodes(),
    ])
    return { attributions, codes }
  },
  component: PendaftarPage,
})

function PendaftarPage() {
  const initial = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()

  // Local search input — debounced before pushing to the URL so we
  // don't spam the server on every keystroke.
  const [qInput, setQInput] = useState(search.q ?? '')

  useEffect(() => {
    if (qInput === (search.q ?? '')) return
    const timer = setTimeout(() => {
      void navigate({
        to: '/referrals/pendaftar',
        search: {
          page: 1, // reset to first page when search changes
          q: qInput.trim() || undefined,
          codeId: search.codeId,
          status: search.status,
        },
      })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput])

  // Keep the input in sync when search params change via back/forward.
  useEffect(() => {
    setQInput(search.q ?? '')
  }, [search.q])

  const { data = initial.attributions } = useQuery({
    queryKey: ['tenant', 'referral-attributions-list', search],
    queryFn: () =>
      listMyAttributions({
        data: {
          page: search.page,
          pageSize: PAGE_SIZE,
          search: search.q,
          codeId: search.codeId,
          status: search.status,
        },
      }),
    initialData: initial.attributions,
    staleTime: 15_000,
  })

  const codes = initial.codes
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const start = data.total === 0 ? 0 : (search.page - 1) * PAGE_SIZE + 1
  const end = Math.min(data.total, search.page * PAGE_SIZE)

  function updateSearch(next: Partial<typeof search>) {
    void navigate({
      to: '/referrals/pendaftar',
      search: {
        // Any filter change resets pagination to page 1. `next` is
        // spread last so a caller can override `page` explicitly if
        // it really wants to (no current caller does).
        ...search,
        ...next,
        page: 1,
      },
    })
  }

  function goToPage(page: number) {
    void navigate({
      to: '/referrals/pendaftar',
      search: { ...search, page },
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Pendaftar via Kode Anda</CardTitle>
            <CardDescription className="mt-1">
              Daftar tenant yang mendaftar lewat salah satu kode referral Anda.
              Komisi otomatis dicatat saat mereka aktivasi paket berbayar dalam
              masa 12 bulan sejak pendaftaran.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filters row */}
        <div className="grid gap-3 sm:grid-cols-12">
          <div className="relative sm:col-span-6">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari nama tenant…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="sm:col-span-3">
            <Select
              value={search.codeId ?? ''}
              onChange={(e) =>
                updateSearch({ codeId: (e.target.value || undefined) as typeof search.codeId })
              }
              options={[
                { value: '', label: 'Semua kode' },
                ...codes.map((c) => ({
                  value: c.id,
                  label: `${c.code}${c.label ? ` — ${c.label}` : ''}`,
                })),
              ]}
            />
          </div>
          <div className="sm:col-span-3">
            <Select
              value={search.status ?? ''}
              onChange={(e) =>
                updateSearch({ status: (e.target.value || undefined) as typeof search.status })
              }
              options={[
                { value: '', label: 'Semua status' },
                { value: 'paid', label: 'Sudah bayar' },
                { value: 'unpaid', label: 'Belum bayar' },
              ]}
            />
          </div>
        </div>

        {/* Table */}
        {data.items.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {search.q || search.codeId || search.status
              ? 'Tidak ada pendaftar yang cocok dengan filter.'
              : 'Belum ada pendaftar. Bagikan kode referral Anda di sosial media untuk mulai mengundang.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Daftar Via Kode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total Bayar</TableHead>
                    <TableHead className="text-right">Komisi Anda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((r) => (
                    <TableRow key={r.attributionId}>
                      <TableCell>
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {r.refereeName}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Daftar {formatDate(r.attributedAt, 'dd MMM yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          {r.code}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.invoiceCount === 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                            Belum bayar
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
                              {r.invoiceCount}× bayar
                            </span>
                            {r.activeModules.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {r.activeModules.map((m) => (
                                  <span
                                    key={m}
                                    className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"
                                  >
                                    {m}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatRupiah(parseFloat(r.totalPaid))}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-success-700 dark:text-success-400">
                        {formatRupiah(parseFloat(r.totalCommission))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-col items-center justify-between gap-2 border-t border-gray-200 pt-3 sm:flex-row dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Menampilkan {start}-{end} dari {data.total} pendaftar
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={search.page <= 1}
                    onClick={() => goToPage(search.page - 1)}
                    aria-label="Halaman sebelumnya"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 text-sm text-gray-600 dark:text-gray-400">
                    Hal {search.page} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={search.page >= totalPages}
                    onClick={() => goToPage(search.page + 1)}
                    aria-label="Halaman berikutnya"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
