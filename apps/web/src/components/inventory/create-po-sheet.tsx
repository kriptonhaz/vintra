import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { listInventoryFormMasters } from '@/server/functions/inventory'
import {
  createPurchaseOrder,
  listItemsForPO,
} from '@/server/functions/inventory-po'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Combobox } from '@/components/ui/combobox'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'

interface DraftLine {
  /** Local row id — independent of itemId so the user can pick the
   *  same item twice (different unit costs / batches) without React
   *  key collisions. */
  rowKey: string
  itemId: string
  /** Ordered unit — one of the picked item's units (base or alt). */
  unitId: string
  orderedQty: string
  unitCost: string
  /**
   * Editable line subtotal (Rp). Stays in sync with qty × unitCost
   * unless the user types into it directly — then we treat the
   * typed value as truth and back-derive unitCost = subtotal / qty.
   * Solves the rounding pain when buying packs (1 gallon = 19000ml
   * @ Rp 6.000): user types subtotal=6000 → derived unit_cost
   * = 0.31578... so the line total exactly matches the receipt
   * instead of drifting to Rp 6.080.
   */
  subtotal: string
  /** Which of qty/unitCost/subtotal was edited last — drives which
   *  field is "truth" when the others auto-derive. */
  lastTouched: 'qty' | 'unitCost' | 'subtotal'
  /** Optional reseller field: new selling price per base unit. When
   *  set + the line is received, inventory_items.sellingPrice updates. */
  sellingPrice: string
  notes: string
}

const newLine = (): DraftLine => ({
  rowKey: Math.random().toString(36).slice(2),
  itemId: '',
  unitId: '',
  orderedQty: '',
  unitCost: '',
  subtotal: '',
  lastTouched: 'unitCost',
  sellingPrice: '',
  notes: '',
})

/**
 * Auto-fill the Subtotal input as a clean integer Rupiah string when
 * the user is typing into qty or unitCost. Avoids "0.32 × 19000 =
 * 6079.99…" rendering as a noisy decimal in the field.
 */
function formatSubtotal(n: number): string {
  return Math.round(n).toString()
}

/**
 * Slide-in form to draft a Purchase Order. Submits to
 * `createPurchaseOrder` server fn and hands the new PO id back to the
 * caller (typically the list page, which then navigates to detail).
 */
export function CreatePoSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (newPoId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()

  // Lazy-fetch masters when the sheet first opens. Cached for the rest
  // of the session — suppliers/items don't change between opens often.
  const { data: masters } = useQuery({
    queryKey: ['inventory', 'form-masters'],
    queryFn: () => listInventoryFormMasters(),
    enabled: open,
    staleTime: 60_000,
  })
  const { data: itemsList } = useQuery({
    queryKey: ['inventory', 'po-items'],
    queryFn: () => listItemsForPO(),
    enabled: open,
    staleTime: 60_000,
  })

  const [supplierId, setSupplierId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [expectedAt, setExpectedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([newLine()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on each open so the form doesn't retain stale data from
  // the user's previous draft.
  useEffect(() => {
    if (open) {
      setSupplierId('')
      setBranchId('')
      setExpectedAt('')
      setNotes('')
      setLines([newLine()])
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  // Default branch to the user's first available one (only one for
  // Free, but Free can't reach this sheet anyway since PO is Toko+).
  useEffect(() => {
    if (open && masters?.branches[0] && !branchId) {
      setBranchId(masters.branches[0].id)
    }
  }, [open, masters, branchId])

  const itemOptions = useMemo(
    () =>
      (itemsList ?? []).map((it) => ({
        value: it.id,
        label: it.sku ? `${it.name} (${it.sku})` : it.name,
      })),
    [itemsList],
  )

  type POItem = NonNullable<typeof itemsList>[number]
  const itemById = useMemo(() => {
    const map = new Map<string, POItem>()
    for (const it of itemsList ?? []) map.set(it.id, it)
    return map
  }, [itemsList])

  function updateLine(rowKey: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => (l.rowKey === rowKey ? { ...l, ...patch } : l)),
    )
  }

  /**
   * Field-edit handler that keeps the qty / unitCost / subtotal
   * triplet consistent. Whichever field the user just typed into is
   * "truth"; the other two are derived. Cases:
   *   touched qty       → recompute subtotal = qty × unitCost
   *   touched unitCost  → recompute subtotal = qty × unitCost
   *   touched subtotal  → derive   unitCost  = subtotal / qty
   *                       (qty stays as-is so receipts that say
   *                        "1 galon = 19000 ml @ Rp 6.000" land cleanly)
   */
  function editLineField(
    rowKey: string,
    field: 'qty' | 'unitCost' | 'subtotal',
    rawValue: string,
  ) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.rowKey !== rowKey) return l
        const next: DraftLine = { ...l, lastTouched: field }
        if (field === 'qty') {
          next.orderedQty = rawValue
          const q = Number(rawValue) || 0
          const c = Number(l.unitCost) || 0
          next.subtotal = q > 0 && c > 0 ? formatSubtotal(q * c) : l.subtotal
        } else if (field === 'unitCost') {
          next.unitCost = rawValue
          const q = Number(l.orderedQty) || 0
          const c = Number(rawValue) || 0
          next.subtotal = q > 0 && c > 0 ? formatSubtotal(q * c) : l.subtotal
        } else {
          next.subtotal = rawValue
          const q = Number(l.orderedQty) || 0
          const sub = Number(rawValue) || 0
          // Carry the higher-precision derived unit cost — the input
          // hides extra zeros via toString() but the value itself
          // keeps the precision the user paid at.
          next.unitCost = q > 0 && sub > 0 ? String(sub / q) : l.unitCost
        }
        return next
      }),
    )
  }

  function removeLine(rowKey: string) {
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((l) => l.rowKey !== rowKey),
    )
  }

  // Live total. When the user typed subtotal directly, that value is
  // the truth — sum it as-is. When subtotal is derived, qty × unitCost
  // matches subtotal exactly so either works.
  const total = lines.reduce((sum, l) => {
    const sub = Number(l.subtotal) || 0
    if (sub > 0) return sum + sub
    const q = Number(l.orderedQty) || 0
    const c = Number(l.unitCost) || 0
    return sum + q * c
  }, 0)

  /** The item's default-display unit, or its first unit. */
  function defaultUnit(item: POItem | undefined) {
    if (!item || item.units.length === 0) return undefined
    return item.units.find((u) => u.isDefault) ?? item.units[0]
  }

  // On item pick, default to the item's display unit and pre-fill the
  // unit cost = base cost × that unit's ratio (a starting guess the
  // user overrides with the real invoice price).
  function handlePickItem(rowKey: string, itemId: string) {
    const item = itemById.get(itemId)
    const unit = defaultUnit(item)
    const ratio = unit?.ratioToBase ?? 1
    const cost = item ? item.costPrice * ratio : 0
    updateLine(rowKey, {
      itemId,
      unitId: unit?.unitId ?? '',
      unitCost: cost > 0 ? String(cost) : '',
      subtotal: '',
      lastTouched: 'unitCost',
    })
  }

  // On unit change, re-prefill the per-unit cost (the unit's meaning
  // changed) and recompute the subtotal.
  function handlePickUnit(rowKey: string, unitId: string) {
    const line = lines.find((l) => l.rowKey === rowKey)
    const item = line ? itemById.get(line.itemId) : undefined
    const unit = item?.units.find((u) => u.unitId === unitId)
    const ratio = unit?.ratioToBase ?? 1
    const cost = item ? item.costPrice * ratio : 0
    const q = Number(line?.orderedQty) || 0
    updateLine(rowKey, {
      unitId,
      unitCost: cost > 0 ? String(cost) : (line?.unitCost ?? ''),
      subtotal: q > 0 && cost > 0 ? formatSubtotal(q * cost) : '',
      lastTouched: 'unitCost',
    })
  }

  async function submit() {
    setError(null)

    if (!supplierId) {
      setError(t('inventory.poCreateErrSupplier'))
      return
    }
    if (!branchId) {
      setError(t('inventory.poCreateErrBranch'))
      return
    }
    const cleanLines = lines
      .map((l) => ({
        itemId: l.itemId,
        unitId: l.unitId || null,
        orderedQty: Number(l.orderedQty) || 0,
        unitCost: Number(l.unitCost) || 0,
        // Send subtotal only when the user typed it directly — that
        // tells the server "this is the price I actually paid, treat
        // it as truth and back-derive a higher-precision unit_cost".
        // When derived (qty/unitCost was last touched) we omit it so
        // the server uses the legacy qty × unitCost path.
        subtotal:
          l.lastTouched === 'subtotal' && l.subtotal.trim() !== ''
            ? Number(l.subtotal) || 0
            : null,
        // Send sellingPrice only when the user explicitly typed
        // something (empty string → leave inventory item's price alone
        // on receive). Pre-filled defaults still send the same value
        // so it's idempotent.
        sellingPrice:
          l.sellingPrice.trim() === '' ? null : Number(l.sellingPrice) || 0,
        notes: l.notes.trim() || null,
      }))
      .filter((l) => l.itemId && l.orderedQty > 0)

    if (cleanLines.length === 0) {
      setError(t('inventory.poCreateErrLines'))
      return
    }

    setSubmitting(true)
    try {
      const created = await createPurchaseOrder({
        data: {
          supplierId,
          branchId,
          expectedAt: expectedAt || null,
          notes: notes.trim() || null,
          lines: cleanLines,
        },
      })
      if (!created) throw new Error('PO creation returned empty')
      toast({
        title: t('common.toastSavedTitle'),
        description: t('inventory.poCreatedToast', {
          poNumber: created.poNumber,
        }),
        variant: 'success',
      })
      await onCreated(created.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan PO'
      setError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('inventory.poCreate')}</SheetTitle>
        <SheetDescription>{t('inventory.poCreateDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('inventory.poFieldSupplier')} *
              </label>
              <Select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                options={[
                  { value: '', label: t('inventory.poSupplierPlaceholder') },
                  ...(masters?.suppliers.map((s) => ({
                    value: s.id,
                    label: s.name,
                  })) ?? []),
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('inventory.poFieldBranch')} *
              </label>
              <Select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={
                  masters?.branches.map((b) => ({
                    value: b.id,
                    label: b.name,
                  })) ?? []
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.poFieldExpectedAt')}
            </label>
            <DateInput
              value={expectedAt}
              onChange={setExpectedAt}
            />
            <p className="mt-1 text-xs text-gray-500">
              {t('inventory.poFieldExpectedAtHint')}
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.poLines')} *
            </label>

            <div className="space-y-2">
              {lines.map((line, idx) => {
                const lineItem = itemById.get(line.itemId)
                const lineUnits = lineItem?.units ?? []
                const baseUnitLabel = lineUnits.find(
                  (u) => u.ratioToBase === 1,
                )?.label
                const unitLabel =
                  lineUnits.find((u) => u.unitId === line.unitId)?.label ?? ''
                return (
                  <div
                    key={line.rowKey}
                    className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/40"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t('inventory.poLineN', { n: idx + 1 })}
                      </span>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(line.rowKey)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-danger-600 dark:hover:bg-gray-700"
                          aria-label="Hapus baris"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Combobox
                        value={line.itemId}
                        onChange={(v) => handlePickItem(line.rowKey, v)}
                        placeholder={t('inventory.poLineItemPlaceholder')}
                        searchPlaceholder={t(
                          'inventory.searchItemPlaceholder',
                        )}
                        emptyResultLabel={t('inventory.searchNoResults')}
                        options={itemOptions}
                        clearable={false}
                      />
                      {lineUnits.length > 0 && (
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">
                            Unit Pesanan
                          </label>
                          <Select
                            value={line.unitId}
                            onChange={(e) =>
                              handlePickUnit(line.rowKey, e.target.value)
                            }
                            options={lineUnits.map((u) => ({
                              value: u.unitId,
                              label:
                                u.ratioToBase !== 1 && baseUnitLabel
                                  ? `${u.label} (= ${u.ratioToBase} ${baseUnitLabel})`
                                  : u.label,
                            }))}
                          />
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">
                            {t('inventory.poLineQty')}
                            {unitLabel && ` (${unitLabel})`}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            value={line.orderedQty}
                            onChange={(e) =>
                              editLineField(
                                line.rowKey,
                                'qty',
                                e.target.value,
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-0.5 block text-xs text-gray-500">
                            {t('inventory.poLineUnitCost')}
                            {unitLabel && ` / ${unitLabel}`}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            // step="any" — per-base-unit cost is
                            // routinely fractional (Rp 0,32/ml from a
                            // gallon-priced material).
                            step="any"
                            value={line.unitCost}
                            onChange={(e) =>
                              editLineField(
                                line.rowKey,
                                'unitCost',
                                e.target.value,
                              )
                            }
                          />
                        </div>
                      </div>
                      {/* min-h on each label reserves the same
                          vertical space so the inputs share a
                          baseline even when the left label wraps to
                          two lines ("Harga Jual Baru / Mililiter
                          (ml) (opsional)") and Subtotal stays on
                          one. items-end keeps the text bottom-
                          aligned with the input start. */}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-0.5 flex min-h-[2.5rem] items-end text-xs text-gray-500">
                            <span>
                              Harga Jual Baru{unitLabel && ` / ${unitLabel}`}{' '}
                              <span className="font-normal text-gray-400">
                                (opsional)
                              </span>
                            </span>
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={line.sellingPrice}
                            onChange={(e) =>
                              updateLine(line.rowKey, {
                                sellingPrice: e.target.value,
                              })
                            }
                            placeholder="Kosongkan = tidak ubah"
                          />
                          <p className="mt-1 text-xs text-gray-400">
                            Diterapkan saat PO diterima.
                          </p>
                        </div>
                        <div>
                          <label className="mb-0.5 flex min-h-[2.5rem] items-end text-xs text-gray-500">
                            {t('inventory.poLineSubtotal')}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.subtotal}
                            onChange={(e) =>
                              editLineField(
                                line.rowKey,
                                'subtotal',
                                e.target.value,
                              )
                            }
                            placeholder="cth. 6.000"
                          />
                          <p className="mt-1 text-xs text-gray-400">
                            Edit langsung jika beli per kemasan (cth.
                            1 galon = Rp 6.000) — harga satuan
                            otomatis disesuaikan.
                          </p>
                        </div>
                      </div>
                      <Input
                        value={line.notes}
                        onChange={(e) =>
                          updateLine(line.rowKey, { notes: e.target.value })
                        }
                        placeholder={t('inventory.poLineNotesPlaceholder')}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Add-row button sits below the cards so a long list adds
                the next row right where the user just finished. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((p) => [...p, newLine()])}
              className="mt-2 w-full gap-1"
            >
              <Plus className="h-4 w-4" />
              {t('inventory.poLineAdd')}
            </Button>

            <div className="mt-3 flex items-center justify-between rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-900/40 dark:bg-brand-900/10">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {t('inventory.poTotal')}
              </span>
              <span className="text-lg font-bold text-brand-700 dark:text-brand-300">
                {formatRupiah(total)}
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.poFieldNotes')}
            </label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('inventory.poFieldNotesPlaceholder')}
            />
          </div>

          {error && (
            <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={submitting}>
            {t('inventory.poCreateBtn')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
