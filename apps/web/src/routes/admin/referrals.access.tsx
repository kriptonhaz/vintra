import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { listTenantReferralAccess } from '@/server/functions/admin-referral-access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const Route = createFileRoute('/admin/referrals/access')({
  loader: () =>
    listTenantReferralAccess({ data: { page: 1, pageSize: 25 } }),
  component: AdminReferralAccessPage,
})

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'unset'

const STATUS_LABEL: Record<'enabled' | 'disabled' | 'unset', string> = {
  enabled: 'Aktif',
  disabled: 'Nonaktif',
  unset: 'Belum diset',
}

const STATUS_CLASSES: Record<'enabled' | 'disabled' | 'unset', string> = {
  enabled:
    'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
  disabled:
    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  unset:
    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Semua' },
  { key: 'enabled', label: 'Aktif' },
  { key: 'disabled', label: 'Nonaktif' },
  { key: 'unset', label: 'Belum diset' },
]

function AdminReferralAccessPage() {
  const initial = Route.useLoaderData()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)

  const { data = initial, isFetching } = useQuery({
    queryKey: ['admin-referral-access-list', search, status, page],
    queryFn: () =>
      listTenantReferralAccess({
        data: {
          page,
          pageSize: 25,
          search: search || undefined,
          status: status === 'all' ? undefined : status,
        },
      }),
    initialData:
      search === '' && status === 'all' && page === 1 ? initial : undefined,
    staleTime: 30_000,
  })

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  function applySearch() {
    setSearch(searchInput.trim())
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Audit Akses Referral</CardTitle>
          <CardDescription>
            Daftar semua tenant dan status akses program referral mereka.
            Halaman ini hanya untuk audit — ubah akses + cap lewat halaman
            detail tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2">
              <Input
                placeholder="Cari nama tenant…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch()
                }}
                className="w-56"
              />
              <Button variant="outline" onClick={applySearch}>
                Cari
              </Button>
            </div>
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    setStatus(f.key)
                    setPage(1)
                  }}
                  className={
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ' +
                    (status === f.key
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800')
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cap</TableHead>
                <TableHead className="text-right">Kode aktif</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-sm text-gray-500"
                  >
                    Tidak ada tenant yang cocok.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((row) => (
                  <TableRow key={row.tenantId}>
                    <TableCell className="font-medium">
                      {row.businessName}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium ' +
                          STATUS_CLASSES[row.status]
                        }
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.capPct != null ? `${row.capPct}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.activeCodeCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to="/admin/tenants/$tenantId"
                        params={{ tenantId: row.tenantId }}
                        className="text-sm text-brand-600 hover:underline dark:text-brand-400"
                      >
                        Atur →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <span>
          {data.total} tenant{isFetching ? ' · memuat…' : ''}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Sebelumnya
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Berikutnya
          </Button>
        </div>
      </div>
    </div>
  )
}
