import { useState, useMemo, useEffect } from 'react'
import { createFileRoute, useRouter, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  Settings2,
  Sparkles,
  Trash2,
  ClipboardCheck,
} from 'lucide-react'
import {
  listInventoryMovements,
  recordMovement,
  listInventoryItems,
  listInventoryFormMasters,
  getInventoryOverview,
  getItemMovementUnits,
  deleteMovement,
} from '@/server/functions/inventory'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { formatRupiah } from '@/lib/currency'
import { cn, formatDate, formatNumberID } from '@/lib/utils' // JUR-137

const MOVEMENTS_PAGE_SIZE = 50

export const Route = createFileRoute('/_authed/inventory/movements/')({
  loader: async () => {
    // The movement history is fetched client-side (it follows the
    // topbar branch switcher); the loader only preps the branch-
    // agnostic data the "record movement" form needs.
    const [items, masters, overview] = await Promise.all([
      // 500 = the server's own cap. The previous 200 was exactly the size of
      // JuraganQu's largest tenant, i.e. zero headroom: one more item and
      // entries would have vanished from the picker and the filter with no
      // error to notice.
      listInventoryItems({ data: { page: 1, pageSize: 500 } }),
      listInventoryFormMasters(),
      getInventoryOverview(),
    ])
    return { items, masters, overview }
  },
  component: MovementsPage,
})

const movementSchema = z.object({
  itemId: z.string().uuid('Pilih item'),
  branchId: z.string().uuid('Pilih cabang'),
  movementType: z.enum(['in', 'out']),
  unitId: z.string().uuid().optional(),
  quantity: z.coerce.number().positive('Jumlah harus > 0'),
  unitCost: z.coerce.number().min(0).optional(),
  reason: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
})
type MovementForm = z.infer<typeof movementSchema>

function MovementsPage() {
  const loader = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { toast } = useToast()
  const { selectedBranchId } = useBranch()
  /**
   * The ledger books a row per ingredient per sale, so a busy outlet writes
   * thousands a day. It used to fetch page 1 of 50 with no pager and no
   * filters, which meant the screen showed the last few minutes and nothing
   * older could be reached at all.
   *
   * Paging alone would still be dozens of pages per day, so it opens on TODAY
   * and offers the two cuts an owner actually comes here for: a date range and
   * a single item.
   */
  const todayStr = new Date().toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState(todayStr)
  const [filterItemId, setFilterItemId] = useState('')
  const [page, setPage] = useState(1)
  const [recordOpen, setRecordOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // A page number from the previous filter is meaningless, and an
  // out-of-range page renders an empty table that reads as "no movements".
  useEffect(() => {
    setPage(1)
  }, [selectedBranchId, fromDate, toDate, filterItemId])

  // History follows the topbar branch switcher.
  const movementsQuery = useQuery({
    queryKey: [
      'inventory',
      'movements',
      selectedBranchId,
      fromDate,
      toDate,
      filterItemId,
      page,
    ],
    queryFn: () =>
      listInventoryMovements({
        data: {
          page,
          pageSize: MOVEMENTS_PAGE_SIZE,
          branchId: selectedBranchId ?? undefined,
          from: fromDate || undefined,
          to: toDate || undefined,
          itemId: filterItemId || undefined,
        },
      }),
    // Keep the current rows while the next page loads so the table does not
    // collapse and shove the layout around.
    placeholderData: (prev) => prev,
  })
  const movements = movementsQuery.data?.items ?? []
  const movementToDelete = movements.find((m) => m.id === deletingId) ?? null

  async function handleDeleteMovement() {
    if (!deletingId) return
    setDeleting(true)
    try {
      await deleteMovement({ data: { id: deletingId } })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('inventory.movementDeletedToast'),
        variant: 'success',
      })
      setDeletingId(null)
      await router.invalidate()
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] })
      // Stock balances changed → cashier needs a refetch.
      queryClient.invalidateQueries({ queryKey: ['pos'] })
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('inventory.movementsTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {movementsQuery.data?.historyClampedToDays
              ? t('inventory.movementsClampedHint', {
                  days: movementsQuery.data.historyClampedToDays,
                })
              : t('inventory.movementsSubtitle')}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link
            to="/inventory/movements/adjust"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ClipboardCheck className="h-4 w-4" /> Sesuaikan Stok
          </Link>
          <Button variant="brand" onClick={() => setRecordOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> {t('inventory.recordMovement')}
          </Button>
        </div>
      </div>

      {/* Filters. The ledger opens on today because a busy outlet books
          thousands of rows a day — without a default range this screen is
          dozens of pages before it says anything useful. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Dari tanggal
          </label>
          <Input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Sampai tanggal
          </label>
          <Input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Item
          </label>
          <Select
            value={filterItemId}
            onChange={(e) => setFilterItemId(e.target.value)}
            options={[
              { value: '', label: 'Semua item' },
              ...loader.items.items.map((it) => ({
                value: it.id,
                label: it.name,
              })),
            ]}
          />
        </div>
      </div>

      {movementsQuery.isLoading ? (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('common.loading')}
        </p>
      ) : movements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {t('inventory.movementsEmptyTitle')}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('inventory.movementsEmptyBody')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-4">
                <MovementIcon type={m.movementType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                    {m.itemName}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {m.branchName} ·{' '}
                    {formatDate(m.createdAt, 'dd MMM yyyy, HH:mm')}
                    {m.reason && <> · {m.reason}</>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      'font-semibold',
                      m.movementType === 'in'
                        ? 'text-success-600 dark:text-success-400'
                        : m.movementType === 'out'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-700 dark:text-gray-300',
                    )}
                  >
                    {m.movementType === 'in' ? '+' : m.movementType === 'out' ? '−' : '±'}
                    {formatNumberID(m.quantity)}
                  </p>
                  {m.unitCost != null && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      @{formatRupiah(m.unitCost)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingId(m.id)}
                  aria-label={t('inventory.movementDelete')}
                  className="ml-1 shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-danger-600 dark:hover:bg-gray-700 dark:hover:text-danger-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pager. Shown whenever there is more than one page — a count with no
          way to move is just a statistic. */}
      {(movementsQuery.data?.total ?? 0) > MOVEMENTS_PAGE_SIZE && (
        <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Menampilkan {(page - 1) * MOVEMENTS_PAGE_SIZE + 1}–
            {Math.min(page * MOVEMENTS_PAGE_SIZE, movementsQuery.data?.total ?? 0)}{' '}
            dari {movementsQuery.data?.total ?? 0} pergerakan
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page <= 1 || movementsQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Sebelumnya
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {page} /{' '}
              {Math.max(
                1,
                Math.ceil((movementsQuery.data?.total ?? 0) / MOVEMENTS_PAGE_SIZE),
              )}
            </span>
            <Button
              variant="outline"
              disabled={
                page >=
                  Math.ceil(
                    (movementsQuery.data?.total ?? 0) / MOVEMENTS_PAGE_SIZE,
                  ) || movementsQuery.isFetching
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}

      <Sheet open={recordOpen} onClose={() => setRecordOpen(false)}>
        <SheetHeader onClose={() => setRecordOpen(false)}>
          <SheetTitle>{t('inventory.recordMovement')}</SheetTitle>
          <SheetDescription>{t('inventory.recordMovementDesc')}</SheetDescription>
        </SheetHeader>
        <RecordForm
          items={loader.items.items.filter((it) => !it.recipeBacked)}
          branches={loader.masters.branches}
          tier={loader.overview.tier}
          onCancel={() => setRecordOpen(false)}
          onSuccess={async () => {
            setRecordOpen(false)
            toast({
              title: t('common.toastSavedTitle'),
              description: t('inventory.movementCreatedToast'),
              variant: 'success',
            })
            await router.invalidate()
            queryClient.invalidateQueries({
              queryKey: ['inventory', 'movements'],
            })
            // Stock balances changed → cashier needs a refetch.
            queryClient.invalidateQueries({ queryKey: ['pos'] })
          }}
          onError={(msg) =>
            toast({
              title: t('common.toastFailedTitle'),
              description: msg,
              variant: 'error',
            })
          }
        />
      </Sheet>

      <ConfirmDialog
        open={!!deletingId}
        onCancel={() => setDeletingId(null)}
        onConfirm={handleDeleteMovement}
        title={t('inventory.movementDeleteConfirmTitle')}
        description={
          movementToDelete
            ? t('inventory.movementDeleteConfirmDesc', {
                type: t(
                  `inventory.movementType_${movementToDelete.movementType}`,
                ),
                qty: movementToDelete.quantity,
                item: movementToDelete.itemName,
              })
            : ''
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        loading={deleting}
      />
    </div>
  )
}

function MovementIcon({ type }: { type: string }) {
  const cls = cn(
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
    type === 'in'
      ? 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400'
      : type === 'out'
        ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  )
  const Icon =
    type === 'in' ? ArrowDownCircle : type === 'out' ? ArrowUpCircle : Settings2
  return (
    <div className={cls}>
      <Icon className="h-5 w-5" />
    </div>
  )
}

type ItemUnits = Awaited<ReturnType<typeof getItemMovementUnits>>

function RecordForm({
  items,
  branches,
  tier,
  onCancel,
  onSuccess,
  onError,
}: {
  items: { id: string; name: string; sku: string | null; baseUnit: { label: string } }[]
  branches: { id: string; name: string }[]
  tier: 'free' | 'toko' | 'bisnis' | 'multi_outlet'
  onCancel: () => void
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const { t } = useTranslation()
  const form = useForm<MovementForm>({
    resolver: zodResolver(movementSchema),
    defaultValues: {
      itemId: items[0]?.id ?? '',
      branchId: branches[0]?.id ?? '',
      movementType: 'in',
      unitId: undefined,
      quantity: 1,
      unitCost: undefined,
      reason: '',
      notes: '',
    },
  })

  const movementType = form.watch('movementType')
  const itemId = form.watch('itemId')
  const unitId = form.watch('unitId')
  const quantity = form.watch('quantity')
  const unitCost = form.watch('unitCost')

  const itemOptions = useMemo(
    () =>
      items.map((it) => ({
        value: it.id,
        label: it.sku ? `${it.name} (${it.sku})` : it.name,
      })),
    [items],
  )

  // Lazy-load unit options when item changes. Resets unit to base.
  const [itemUnits, setItemUnits] = useState<ItemUnits | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!itemId) {
      setItemUnits(null)
      return
    }
    getItemMovementUnits({ data: { itemId } })
      .then((res) => {
        if (cancelled) return
        setItemUnits(res)
        // Default to base unit on item change.
        form.setValue('unitId', res.baseUnit.id)
      })
      .catch(() => {
        // Silent — picker just won't show alt units.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // Compute the live ratio + per-base-unit derivations for the calc hint.
  const selectedUnit = itemUnits
    ? itemUnits.baseUnit.id === unitId
      ? { label: itemUnits.baseUnit.label, ratioToBase: 1 }
      : (itemUnits.altUnits.find((u) => u.id === unitId) ?? null)
    : null
  const ratio = selectedUnit?.ratioToBase ?? 1
  const isAltUnit = !!selectedUnit && ratio !== 1
  const qtyNum = Number(quantity) || 0
  const costNum = Number(unitCost) || 0
  const qtyInBase = qtyNum * ratio
  const costPerBase = ratio > 0 ? costNum / ratio : 0

  // Free tier nudge: only when an item has an HPP link AND base unit
  // is gram-like — these are the cases users will most want to enter
  // in pcs/dus and currently can't.
  const showFreeTokoNudge =
    tier === 'free' &&
    !!itemUnits?.hasHppLink &&
    movementType === 'in'

  const showAltUnitPicker =
    !!itemUnits && itemUnits.altUnits.length > 0 && tier !== 'free'

  async function onSubmit(values: MovementForm) {
    try {
      await recordMovement({
        data: {
          itemId: values.itemId,
          branchId: values.branchId,
          movementType: values.movementType,
          quantity: values.quantity,
          unitId: values.unitId,
          unitCost: values.unitCost,
          reason: values.reason || null,
          notes: values.notes || null,
        },
      })
      onSuccess()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal menyimpan')
    }
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldItem')} *
          </label>
          <Controller
            name="itemId"
            control={form.control}
            render={({ field }) => (
              <Combobox
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder={t('inventory.fieldItem')}
                searchPlaceholder={t('inventory.searchItemPlaceholder')}
                emptyResultLabel={t('inventory.searchNoResults')}
                options={itemOptions}
                error={form.formState.errors.itemId?.message}
                clearable={false}
              />
            )}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldBranch')} *
          </label>
          <Select
            {...form.register('branchId')}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            error={form.formState.errors.branchId?.message}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldMovementType')} *
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['in', 'out'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => form.setValue('movementType', type)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  movementType === type
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700',
                )}
              >
                {t(`inventory.movementType_${type}`)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Untuk penyesuaian stok (opname) banyak item sekaligus, gunakan{' '}
            <Link
              to="/inventory/movements/adjust"
              className="font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Sesuaikan Stok
            </Link>
            .
          </p>
        </div>

        {/* Quantity + (alt) unit + unit cost. The alt-unit picker only
            appears for Toko+ items with configured conversions; without
            it we just label the input with the base unit. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldQuantity')} *
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                step={0.01}
                {...form.register('quantity')}
                error={form.formState.errors.quantity?.message}
                className="flex-1"
              />
              {showAltUnitPicker ? (
                <Select
                  {...form.register('unitId')}
                  options={[
                    {
                      value: itemUnits!.baseUnit.id,
                      label: itemUnits!.baseUnit.label,
                    },
                    ...itemUnits!.altUnits.map((u) => ({
                      value: u.id,
                      label: u.label,
                    })),
                  ]}
                  className="w-28 shrink-0"
                />
              ) : (
                itemUnits && (
                  <span className="inline-flex h-10 shrink-0 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-300">
                    {itemUnits.baseUnit.label}
                  </span>
                )
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldUnitCost')}
              {selectedUnit && (
                <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                  / {selectedUnit.label}
                </span>
              )}
            </label>
            <Input
              type="number"
              min={0}
              // step="any" — fractional per-base-unit cost (Rp 0,32/ml)
              // is the norm when buying packs and dividing down. Same
              // fix as the inventory item + PO forms.
              step="any"
              {...form.register('unitCost')}
              placeholder={movementType === 'in' ? 'Harga beli' : '—'}
            />
            {movementType === 'in' && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('inventory.fieldUnitCostHint')}
              </p>
            )}
          </div>
        </div>

        {/* Live calculation hint — the most load-bearing piece of UI here.
            Lets the user verify exactly what gets stored before they
            submit. Crucial when alt units are in play because the
            mental math (e.g. 1 pcs = 1000 g, Rp 15.000 / pcs = Rp 15 / g)
            is exactly what users get wrong. */}
        {itemUnits && qtyNum > 0 && (
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 dark:border-brand-900/40 dark:bg-brand-900/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
              {t('inventory.calcPreviewTitle')}
            </p>
            <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {isAltUnit ? (
                <>
                  {qtyNum} {selectedUnit!.label} × {ratio}{' '}
                  {itemUnits.baseUnit.label} ={' '}
                  <span className="font-semibold">
                    {formatNumberID(qtyInBase)}{' '}
                    {itemUnits.baseUnit.label}
                  </span>{' '}
                  {t('inventory.calcWillSave')}
                </>
              ) : (
                <>
                  <span className="font-semibold">
                    {formatNumberID(qtyNum)}{' '}
                    {itemUnits.baseUnit.label}
                  </span>{' '}
                  {t('inventory.calcWillSave')}
                </>
              )}
            </p>
            {costNum > 0 && itemUnits.hasHppLink && movementType === 'in' && (
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                {t('inventory.calcHppSync', {
                  cost: formatRupiah(Math.round(costPerBase * 100) / 100),
                  unit: itemUnits.baseUnit.label,
                })}
              </p>
            )}
          </div>
        )}

        {showFreeTokoNudge && (
          <div className="flex items-start gap-3 rounded-lg border border-accent-200 bg-accent-50 p-3 dark:border-accent-900/40 dark:bg-accent-900/10">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-400" />
            <div className="text-sm text-accent-800 dark:text-accent-200">
              <p className="font-medium">{t('inventory.freeNudgeTitle')}</p>
              <p className="mt-0.5 text-xs text-accent-700 dark:text-accent-300">
                {t('inventory.freeNudgeBody')}{' '}
                <Link
                  to="/inventory/billing"
                  className="font-medium underline hover:text-accent-900 dark:hover:text-accent-100"
                >
                  {t('inventory.freeNudgeCta')}
                </Link>
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldReason')}
          </label>
          <Input
            {...form.register('reason')}
            placeholder={t('inventory.fieldReasonPlaceholder')}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldNotes')}
          </label>
          <Input {...form.register('notes')} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
