import * as React from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, PackagePlus, RefreshCw, Search } from 'lucide-react'
import {
  getHppImportCandidates,
  bulkCreateInventoryItemsFromHpp,
  bulkSyncInventoryItemsFromHpp,
} from '@/server/functions/inventory'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
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
import { formatRupiah } from '@/lib/currency'

export const Route = createFileRoute('/_authed/inventory/items/import')({
  loader: () => getHppImportCandidates(),
  component: ImportPage,
})

type Candidates = Awaited<ReturnType<typeof getHppImportCandidates>>
type MaterialRow = Candidates['materials'][number]
type ProductRow = Candidates['products'][number]
type Row = MaterialRow | ProductRow
type Source = 'material' | 'product'

// Sentinel for the "products with no category" filter option.
const UNCATEGORIZED = '__uncategorized__'

// Rows rendered per page. Keeps the DOM light for big HPP catalogs;
// "Pilih Semua" still spans every page (selection is keyed by id).
const PAGE_SIZE = 30

/**
 * A row is actionable when there is something this page can do to it:
 * create the missing inventory item, or refresh one that has fallen
 * behind HPP. Everything else is already in sync and stays read-only.
 */
function isActionable(r: Row): boolean {
  return !r.alreadyImported || r.needsSync
}

interface RowDraft {
  selected: boolean
  minStockLevel: string
  isSellable: boolean
  isBookable: boolean
  baseUnitId: string
}

/**
 * Seed one draft per HPP candidate. Actionable rows start selected (the
 * common case is "do everything that needs doing"); rows already in sync
 * start unselected and get disabled in the table. Defaults mirror the
 * single-create smart defaults: a raw material hides from POS, a
 * finished product shows in POS.
 */
function buildDrafts(data: Candidates): Record<string, RowDraft> {
  const defaultUnit =
    data.units.find((u) => u.value === 'pcs')?.id ?? data.units[0]?.id ?? ''
  const out: Record<string, RowDraft> = {}
  for (const m of data.materials) {
    out[m.id] = {
      selected: isActionable(m),
      minStockLevel: '',
      isSellable: false,
      isBookable: false,
      baseUnitId: m.unitId,
    }
  }
  for (const p of data.products) {
    out[p.id] = {
      selected: isActionable(p),
      minStockLevel: '',
      isSellable: true,
      isBookable: false,
      baseUnitId: defaultUnit,
    }
  }
  return out
}

function ImportPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  const [tab, setTab] = React.useState<Source>('material')
  const [saving, setSaving] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [drafts, setDrafts] = React.useState<Record<string, RowDraft>>(() =>
    buildDrafts(data),
  )

  // After a save the loader is invalidated; rebuild drafts so the
  // just-processed rows flip to their disabled "Sudah sinkron" state.
  React.useEffect(() => {
    setDrafts(buildDrafts(data))
  }, [data])

  function patch(id: string, p: Partial<RowDraft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...p } }))
  }

  const tabRows: Row[] = tab === 'material' ? data.materials : data.products

  // Category options for the Produk Jadi tab — derived from the
  // products themselves so the dropdown only lists categories in use.
  const categories = React.useMemo(() => {
    const set = new Set<string>()
    for (const p of data.products) {
      if (p.category && p.category.trim()) set.add(p.category)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [data.products])
  const hasUncategorized = React.useMemo(
    () => data.products.some((p) => !p.category || !p.category.trim()),
    [data.products],
  )

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return tabRows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false
      if (tab === 'product' && categoryFilter && 'category' in r) {
        if (categoryFilter === UNCATEGORIZED) {
          if (r.category && r.category.trim()) return false
        } else if (r.category !== categoryFilter) {
          return false
        }
      }
      return true
    })
  }, [tabRows, search, categoryFilter, tab])

  // Reset to page 1 whenever the visible set changes under the user.
  React.useEffect(() => {
    setPage(1)
  }, [tab, search, categoryFilter])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = filteredRows.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  // Selection (what Save submits) spans the whole tab — a row stays
  // selected even when the search/category filter or pagination hides
  // it — and splits by what will actually happen to it.
  const selected = tabRows.filter(
    (r) => isActionable(r) && drafts[r.id]?.selected,
  )
  const toCreate = selected.filter((r) => !r.alreadyImported)
  const toSync = selected.filter((r) => r.alreadyImported)

  // "Pilih Semua" acts on every actionable row matching the current
  // filter — across all pages, not just the page on screen.
  const filteredActionable = filteredRows.filter(isActionable)
  const allSelected =
    filteredActionable.length > 0 &&
    filteredActionable.every((r) => drafts[r.id]?.selected)
  const someSelected = filteredActionable.some((r) => drafts[r.id]?.selected)

  // Native checkboxes can't show "indeterminate" via a prop.
  const selectAllRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected
    }
  })

  function toggleAll() {
    const next = !allSelected
    setDrafts((d) => {
      const copy = { ...d }
      for (const r of filteredActionable)
        copy[r.id] = { ...copy[r.id]!, selected: next }
      return copy
    })
  }

  // SKU quota guard — null cap means unlimited. Only NEW items consume
  // quota; refreshing an existing one costs nothing.
  const remaining =
    data.skuCap != null ? Math.max(0, data.skuCap - data.skuCount) : null
  const overQuota = remaining != null && toCreate.length > remaining
  const driftCount = tabRows.filter(
    (r) => r.alreadyImported && r.needsSync,
  ).length

  async function handleSave() {
    if (selected.length === 0 || overQuota) return
    setSaving(true)
    try {
      const messages: string[] = []

      if (toCreate.length > 0) {
        const items = toCreate.map((r) => {
          const dr = drafts[r.id]!
          return {
            hppId: r.id,
            baseUnitId: dr.baseUnitId,
            minStockLevel:
              tab === 'material' && dr.minStockLevel.trim() !== ''
                ? Number(dr.minStockLevel)
                : null,
            isSellable: dr.isSellable,
            isBookable: dr.isBookable,
          }
        })
        const res = await bulkCreateInventoryItemsFromHpp({
          data: { source: tab, items },
        })
        messages.push(`${res.created} item ditambahkan`)
        if (res.skipped > 0) {
          messages.push(`${res.skipped} dilewati (sudah ada)`)
        }
      }

      if (toSync.length > 0) {
        const res = await bulkSyncInventoryItemsFromHpp({
          data: { source: tab, hppIds: toSync.map((r) => r.id) },
        })
        if (res.costUpdated === 0 && res.priceUpdated === 0) {
          // Reachable: an item flagged as needing a price but whose base
          // unit was never added as a sellable unit has nowhere for the
          // price to land. Saying "0 diperbarui" would read as a failure;
          // this says what actually happened.
          messages.push(`${toSync.length} item sudah sesuai — tidak ada yang berubah`)
        } else {
          messages.push(`${res.costUpdated} harga modal diperbarui`)
          if (res.priceUpdated > 0) {
            messages.push(`${res.priceUpdated} harga jual diperbarui`)
          }
        }
      }

      toast({
        title: 'Berhasil',
        description: `${messages.join(', ')}.`,
        variant: 'success',
      })
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

  const actionLabel =
    toCreate.length > 0 && toSync.length > 0
      ? `Tambah ${toCreate.length} & Perbarui ${toSync.length}`
      : toSync.length > 0
        ? `Perbarui ${toSync.length} Item`
        : `Tambah ${toCreate.length > 0 ? `${toCreate.length} ` : ''}Item`

  return (
    <div className="space-y-6 pb-24">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-2">
        <Link
          to="/inventory/items"
          search={{ view: tab === 'material' ? 'ingredients' : 'sellable' }}
          className="inline-flex w-fit items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali ke Inventaris
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Tambah &amp; Perbarui dari HPP
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Centang item yang ingin ditambahkan ke inventaris, atau yang harganya
          ingin disamakan lagi dengan HPP. Unit dan harga pokok diambil otomatis
          dari HPP.
        </p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-2">
        {(['material', 'product'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setTab(s)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === s
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {s === 'material' ? 'Bahan Baku' : 'Produk Jadi'}
          </button>
        ))}
      </div>

      {remaining != null && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Item aktif: {data.skuCount}/{data.skuCap} — sisa kuota {remaining}.
        </p>
      )}

      {driftCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-200">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {driftCount} item sudah ada di inventaris tapi harganya belum
            mengikuti HPP terbaru. Sudah dicentang otomatis — tekan tombol di
            bawah untuk menyamakan.
          </p>
        </div>
      )}

      {/* Search + (product-only) category filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            placeholder={
              tab === 'material' ? 'Cari bahan baku…' : 'Cari produk…'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tab === 'product' && (categories.length > 0 || hasUncategorized) && (
          <Select
            className="sm:w-56"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            options={[
              { value: '', label: 'Semua kategori' },
              ...categories.map((c) => ({ value: c, label: c })),
              ...(hasUncategorized
                ? [{ value: UNCATEGORIZED, label: 'Tanpa kategori' }]
                : []),
            ]}
          />
        )}
      </div>

      {filteredActionable.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Centang kotak di header tabel untuk memilih semua{' '}
          {filteredActionable.length} item yang bisa diproses — termasuk yang
          ada di halaman lain.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {tabRows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {tab === 'material'
              ? 'Belum ada bahan baku di HPP.'
              : 'Belum ada produk jadi di HPP.'}
          </p>
        ) : filteredRows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            Tidak ada item yang cocok dengan pencarian.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allSelected}
                    disabled={filteredActionable.length === 0}
                    onChange={toggleAll}
                    aria-label="Pilih semua item yang bisa diproses"
                  />
                </TableHead>
                <TableHead>Nama</TableHead>
                {tab === 'material' ? (
                  <>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Harga Pokok</TableHead>
                    <TableHead>Stok Minimum</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="text-right">Harga Pokok</TableHead>
                    <TableHead className="text-right">Harga Jual</TableHead>
                    <TableHead>Unit Dasar</TableHead>
                  </>
                )}
                <TableHead className="text-center">POS Kasir</TableHead>
                <TableHead className="text-center">Booking</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((r) => {
                const dr = drafts[r.id]
                if (!dr) return null
                const actionable = isActionable(r)
                // Only a brand-new item takes these settings; a refresh
                // touches prices and nothing else.
                const editable = !r.alreadyImported && dr.selected
                return (
                  <TableRow
                    key={r.id}
                    className={actionable ? '' : 'opacity-50'}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={!actionable}
                        checked={actionable && dr.selected}
                        onChange={(e) =>
                          patch(r.id, { selected: e.target.checked })
                        }
                        aria-label={`Pilih ${r.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {r.name}
                      </p>
                      {tab === 'material'
                        ? 'brand' in r &&
                          r.brand && (
                            <p className="text-xs text-gray-500">{r.brand}</p>
                          )
                        : 'category' in r &&
                          r.category && (
                            <p className="text-xs text-gray-500">
                              {r.category}
                            </p>
                          )}
                    </TableCell>

                    {tab === 'material' && 'unitLabel' in r ? (
                      <>
                        <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                          {r.unitLabel}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          <PriceCell
                            current={r.currentCost}
                            target={Number(r.pricePerUnit)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            className="w-24"
                            placeholder="0"
                            disabled={!editable}
                            value={dr.minStockLevel}
                            onChange={(e) =>
                              patch(r.id, { minStockLevel: e.target.value })
                            }
                          />
                        </TableCell>
                      </>
                    ) : 'sellingPrice' in r ? (
                      <>
                        <TableCell className="text-right text-sm">
                          {r.hppPerUnit != null ? (
                            <PriceCell
                              current={r.currentCost}
                              target={r.hppPerUnit}
                            />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          <PriceCell
                            current={r.currentPrice}
                            target={r.targetPrice}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            className="w-28"
                            disabled={!editable}
                            value={dr.baseUnitId}
                            onChange={(e) =>
                              patch(r.id, { baseUnitId: e.target.value })
                            }
                            options={data.units.map((u) => ({
                              value: u.id,
                              label: u.label,
                            }))}
                          />
                        </TableCell>
                      </>
                    ) : null}

                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={!editable}
                        checked={dr.isSellable}
                        onChange={(e) =>
                          patch(r.id, {
                            isSellable: e.target.checked,
                            // Booking implies POS-visible — clear it
                            // when POS is switched off.
                            isBookable: e.target.checked
                              ? dr.isBookable
                              : false,
                          })
                        }
                        aria-label="Tampilkan di POS Kasir"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        disabled={!editable || !dr.isSellable}
                        checked={dr.isBookable}
                        onChange={(e) =>
                          patch(r.id, { isBookable: e.target.checked })
                        }
                        aria-label="Bisa dipesan di Booking"
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge row={r} />
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
            Halaman {safePage} dari {pageCount} · {filteredRows.length} item
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

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800 lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {toCreate.length > 0 && <>{toCreate.length} item baru</>}
            {toCreate.length > 0 && toSync.length > 0 && ' · '}
            {toSync.length > 0 && <>{toSync.length} item diperbarui</>}
            {selected.length === 0 && 'Belum ada item dipilih'}
            {overQuota && (
              <span className="ml-2 text-danger-600">
                — melebihi sisa kuota ({remaining})
              </span>
            )}
          </p>
          <Button
            variant="brand"
            onClick={handleSave}
            loading={saving}
            disabled={selected.length === 0 || overQuota}
          >
            {toCreate.length === 0 && toSync.length > 0 ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <PackagePlus className="h-4 w-4" />
            )}
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * One money column. Shows the HPP value alone for a row with no
 * inventory item yet, and "old → new" when the linked item disagrees —
 * that difference is the whole reason to tick the row.
 */
function PriceCell({
  current,
  target,
}: {
  current: number | null
  target: number
}) {
  if (current == null || current === target) {
    return <span>{formatRupiah(target)}</span>
  }
  return (
    <span className="whitespace-nowrap">
      <span className="text-gray-400 line-through">
        {formatRupiah(current)}
      </span>{' '}
      <span className="font-medium text-warning-700 dark:text-warning-400">
        {formatRupiah(target)}
      </span>
    </span>
  )
}

function StatusBadge({ row }: { row: Row }) {
  if (!row.alreadyImported) {
    return <span className="text-xs text-gray-400">Baru</span>
  }
  if (row.needsSync) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800 dark:bg-warning-900/30 dark:text-warning-300">
        Perlu diperbarui
      </span>
    )
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      Sudah sinkron
    </span>
  )
}
