/**
 * Customer database list page (JUR-6).
 *
 * Mobile-first responsive: card-list on phones, table-style rows on
 * tablet+ via grid-cols. Search bar full-width on mobile, sticky add
 * button. Tier-gated by the `customer_db` POS feature flag.
 */
import { useEffect, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  Phone,
  UserCircle2,
  Mail,
  Stamp,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { listCustomers } from '@/server/functions/customers'
import { exportCustomers } from '@/server/functions/customers-io'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { CustomerFormSheet } from '@/components/pos/customer-form-sheet'
import { ImportCustomersDialog } from '@/components/customer/import-customers-dialog'
import { upsertCustomer } from '@/server/functions/customers'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/master/customers/')({
  component: CustomersListPage,
})

// Server-side pagination — matches the /hpp UX (prev/next + page counter)
// but offloads slicing to the DB so a 5k-row tenant doesn't ship every
// row over the wire on every render.
const PAGE_SIZE = 25

function CustomersListPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Reset to first page whenever the search term changes so the user
  // doesn't end up on an empty later page after narrowing the list.
  useEffect(() => {
    setCurrentPage(1)
  }, [search])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await exportCustomers()
      // base64 → Uint8Array → Blob; mirrors the attendance xlsx export.
      const binary = atob(res.bodyBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      a.click()
      URL.revokeObjectURL(url)
      toast({
        title: 'Export berhasil',
        description: `${res.count} pelanggan diunduh.`,
        variant: 'success',
      })
    } catch (err) {
      toast({
        title: 'Gagal export',
        description: err instanceof Error ? err.message : 'Coba lagi.',
        variant: 'error',
      })
    } finally {
      setExporting(false)
    }
  }

  const customers = useQuery({
    queryKey: ['pos', 'customers', search, currentPage],
    queryFn: () =>
      listCustomers({
        data: {
          search: search || undefined,
          page: currentPage,
          pageSize: PAGE_SIZE,
        },
      }),
    staleTime: 30 * 1000,
    // Keep previous data on page flip / search so the list doesn't
    // flash to a skeleton between requests.
    placeholderData: (prev) => prev,
  })

  const total = customers.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const rangeStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(safePage * PAGE_SIZE, total)

  const createMut = useMutation({
    mutationFn: (input: {
      name: string
      phone?: string | null
      email?: string | null
      notes?: string | null
    }) => upsertCustomer({ data: input }),
    onSuccess: async () => {
      setCreateOpen(false)
      toast({
        title: 'Pelanggan disimpan',
        variant: 'success',
      })
      await queryClient.invalidateQueries({ queryKey: ['pos', 'customers'] })
    },
    onError: (err) => {
      toast({
        title: 'Gagal menyimpan',
        description: err instanceof Error ? err.message : 'Coba lagi.',
        variant: 'error',
      })
    },
  })

  return (
    <div className="space-y-6">
      {/* Header — title above on mobile, action button stacks below;
          inline on tablet+. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Pelanggan
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Database pelanggan tetap. Cashier bisa lookup by nomor HP saat
            menjual; nanti jadi dasar loyalty + promo codes.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="outline"
            onClick={handleExport}
            loading={exporting}
            className="w-full sm:w-auto"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="w-full sm:w-auto"
          >
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button
            variant="brand"
            onClick={() => setCreateOpen(true)}
            className="w-full whitespace-nowrap sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            Tambah Pelanggan
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama atau nomor HP…"
          className="pl-9"
        />
      </div>

      {/* List */}
      {customers.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : customers.data && customers.data.items.length === 0 ? (
        <EmptyState
          title={
            search
              ? 'Tidak ada pelanggan cocok'
              : 'Belum ada pelanggan'
          }
          description={
            search
              ? 'Coba kata kunci lain atau hapus pencarian.'
              : 'Tambah pelanggan pertama, atau cashier akan otomatis bikin saat menjual + isi nomor HP.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {(customers.data?.items ?? []).map((c) => (
            <li key={c.id}>
              <Link
                to="/master/customers/$customerId"
                params={{ customerId: c.id }}
                className={cn(
                  'flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors',
                  'hover:border-brand-400 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40',
                )}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                  <UserCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                    {c.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {c.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {formatPhoneDisplay(c.phone)}
                      </span>
                    )}
                    {c.email && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3" />
                        <span className="truncate">{c.email}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {formatRupiah(c.totalSpent)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {c.visitCount} kunjungan
                  </p>
                  {c.activeStampCards > 0 && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700 ring-1 ring-accent-200 dark:bg-accent-900/20 dark:text-accent-300 dark:ring-accent-800/40">
                      <Stamp className="h-3 w-3" />
                      {c.activeStampCards} kartu · {c.currentStamps} stempel
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination — mirrors /hpp's prev/next + counter pattern.
          Hidden when the whole result set fits on one page so the
          common single-warung tenant doesn't see chrome they don't
          need. */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-gray-200 px-2 pt-4 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Menampilkan {rangeStart}&ndash;{rangeEnd} dari {total} pelanggan
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1 || customers.isFetching}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages, p + 1))
              }
              disabled={safePage === totalPages || customers.isFetching}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <CustomerFormSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createMut.mutate(values)}
        loading={createMut.isPending}
      />

      <ImportCustomersDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </div>
  )
}

/**
 * Display a stored "62..." phone in a more readable form: "+62 812 3456".
 * Reverses the server-side normalisation only for presentation; storage
 * stays canonical.
 */
function formatPhoneDisplay(phone: string): string {
  if (!phone.startsWith('62')) return phone
  const rest = phone.slice(2)
  // Group into 3-4-... segments for readability. Loose grouping: every
  // 3-4 digits with spaces.
  const grouped = rest.replace(/(\d{3})(\d{4})(\d+)?/, (_, a, b, c) =>
    c ? `${a} ${b} ${c}` : `${a} ${b}`,
  )
  return `+62 ${grouped}`
}
