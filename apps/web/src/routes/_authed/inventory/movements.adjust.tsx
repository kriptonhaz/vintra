import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ClipboardCheck, Search, RotateCcw } from 'lucide-react'
import {
  getStockAdjustmentData,
  bulkRecordStockOpname,
} from '@/server/functions/inventory'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatNumberID } from '@/lib/utils'

export const Route = createFileRoute('/_authed/inventory/movements/adjust')({
  loader: () => getStockAdjustmentData({ data: {} }),
  component: AdjustPage,
})

type AdjustData = Awaited<ReturnType<typeof getStockAdjustmentData>>
const UNCATEGORIZED = '__uncategorized__'
const PAGE_SIZE = 30

interface RowDraft {
  actualQty: string
  note: string
}

const TYPE_LABEL: Record<string, string> = {
  bahan_baku: 'Bahan Baku',
  barang: 'Barang',
}

function AdjustPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  // Branch comes from the global topbar switcher — single source of truth.
  const { selectedBranchId } = useBranch()
  const branchId = selectedBranchId ?? ''
  const [search, setSearch] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState('')
  const [onlyAdjusted, setOnlyAdjusted] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [drafts, setDrafts] = React.useState<Record<string, RowDraft>>({})
  const [saving, setSaving] = React.useState(false)

  const { data } = useQuery({
    queryKey: ['inventory', 'stock-adjust', branchId],
    queryFn: () =>
      getStockAdjustmentData({
        data: { branchId: branchId || undefined },
      }),
    initialData:
      branchId === (initial.branchId ?? '') ? initial : undefined,
  })
  const view: AdjustData = data ?? initial

  // A stock count is branch-specific — drop drafts when the branch
  // changes so a count entered for branch A can't leak into branch B.
  React.useEffect(() => {
    setDrafts({})
    setPage(1)
  }, [branchId])

  React.useEffect(() => {
    setPage(1)
  }, [search, categoryFilter, typeFilter, onlyAdjusted])

  function patch(id: string, p: Partial<RowDraft>) {
    setDrafts((d) => ({
      ...d,
      [id]: { actualQty: '', note: '', ...d[id], ...p },
    }))
  }
  function resetRow(id: string) {
    setDrafts((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
  }

  /** A row is "adjusted" once a valid actual quantity is entered. */
  function isAdjusted(id: string): boolean {
    const v = drafts[id]?.actualQty
    return v != null && v.trim() !== '' && !Number.isNaN(Number(v))
  }

  const categories = view.categories
  const hasUncategorized = React.useMemo(
    () => view.items.some((i) => !i.categoryId),
    [view.items],
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return view.items.filter((it) => {
      if (q && !it.name.toLowerCase().includes(q)) return false
      if (categoryFilter) {
        if (categoryFilter === UNCATEGORIZED) {
          if (it.categoryId) return false
        } else if (it.categoryId !== categoryFilter) return false
      }
      if (typeFilter && it.type !== typeFilter) return false
      if (onlyAdjusted && !isAdjusted(it.id)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.items, search, categoryFilter, typeFilter, onlyAdjusted, drafts])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  const adjustedCount = view.items.filter((it) => isAdjusted(it.id)).length

  async function handleSave() {
    if (adjustedCount === 0 || !branchId) return
    setSaving(true)
    try {
      const adjustments = view.items
        .filter((it) => isAdjusted(it.id))
        .map((it) => ({
          itemId: it.id,
          actualQty: Number(drafts[it.id]!.actualQty),
          note: drafts[it.id]?.note?.trim() || null,
        }))
      const res = await bulkRecordStockOpname({
        data: { branchId, adjustments },
      })
      toast({
        title: 'Berhasil',
        description:
          `${res.adjusted} item disesuaikan` +
          (res.skipped > 0 ? `, ${res.skipped} dilewati (tanpa perubahan).` : '.'),
        variant: 'success',
      })
      setDrafts({})
      await router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal',
        description: err instanceof Error ? err.message : 'Gagal menyimpan',
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-2">
        <Link
          to="/inventory/movements"
          className="inline-flex w-fit items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali ke Pergerakan Stok
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Sesuaikan Stok
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Isi stok sebenarnya hasil hitung fisik. Sistem mencatat selisihnya
          sebagai pergerakan stok opname.
        </p>
      </div>

      {/* Branch + filters */}
      <div className="flex flex-col gap-3">
        <div className="sm:max-w-xs">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Cabang
          </label>
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {view.branches.find((b) => b.id === branchId)?.name ?? '—'}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Cari item…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {(categories.length > 0 || hasUncategorized) && (
            <Select
              className="sm:w-52"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={[
                { value: '', label: 'Semua kategori' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
                ...(hasUncategorized
                  ? [{ value: UNCATEGORIZED, label: 'Tanpa kategori' }]
                  : []),
              ]}
            />
          )}
          <Select
            className="sm:w-44"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={[
              { value: '', label: 'Semua jenis' },
              { value: 'bahan_baku', label: 'Bahan Baku' },
              { value: 'barang', label: 'Barang' },
            ]}
          />
        </div>
        <label className="flex w-fit items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={onlyAdjusted}
            onChange={(e) => setOnlyAdjusted(e.target.checked)}
          />
          Tampilkan hanya item yang disesuaikan
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {view.items.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            Belum ada item yang bisa disesuaikan di cabang ini.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            Tidak ada item yang cocok dengan pencarian.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="text-right">Stok Sistem</TableHead>
                <TableHead>Stok Sebenarnya</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((it) => {
                const draft = drafts[it.id]
                const raw = draft?.actualQty ?? ''
                const filledIn = raw.trim() !== '' && !Number.isNaN(Number(raw))
                const delta = filledIn ? Number(raw) - it.systemStock : 0
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">
                      {it.name}
                      {it.sku && (
                        <p className="text-xs text-gray-500">{it.sku}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      {TYPE_LABEL[it.type] ?? it.type}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                      {it.baseUnitLabel}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatNumberID(it.systemStock)}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        className="w-28"
                        placeholder="Stok sebenarnya"
                        value={raw}
                        onChange={(e) =>
                          patch(it.id, { actualQty: e.target.value })
                        }
                      />
                      {filledIn && delta !== 0 && (
                        <p
                          className={
                            delta > 0
                              ? 'mt-1 text-xs font-medium text-success-600 dark:text-success-400'
                              : 'mt-1 text-xs font-medium text-danger-600'
                          }
                        >
                          {delta > 0 ? '+' : ''}
                          {formatNumberID(delta)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {filledIn ? (
                        <Input
                          className="w-44"
                          placeholder="Catatan (opsional)"
                          value={draft?.note ?? ''}
                          onChange={(e) =>
                            patch(it.id, { note: e.target.value })
                          }
                        />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {draft && (
                        <button
                          type="button"
                          onClick={() => resetRow(it.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-danger-600 hover:underline"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reset
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Halaman {safePage} dari {pageCount} · {filtered.length} item
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800 lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {adjustedCount} item disesuaikan
          </p>
          <Button
            variant="brand"
            onClick={handleSave}
            loading={saving}
            disabled={adjustedCount === 0 || !branchId}
          >
            <ClipboardCheck className="h-4 w-4" />
            Simpan Penyesuaian
          </Button>
        </div>
      </div>
    </div>
  )
}
