import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { listInventoryFormMasters } from '@/server/functions/inventory'
import {
  createRequisition,
  listItemsForRequisition,
} from '@/server/functions/inventory-requisitions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

interface DraftLine {
  /** Local row id — lets the same item appear twice without key clashes. */
  rowKey: string
  itemId: string
  /** Picked unit (defaults to the item's base unit on item pick). */
  unitId: string
  requestedQty: string
  notes: string
}

const newLine = (): DraftLine => ({
  rowKey: Math.random().toString(36).slice(2),
  itemId: '',
  unitId: '',
  requestedQty: '',
  notes: '',
})

/**
 * Slide-in form for an outlet to raise a stock requisition against the
 * main branch. Submits to `createRequisition` and hands the new
 * requisition id back to the caller.
 */
export function CreateRequisitionSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
}) {
  const { toast } = useToast()

  const { data: masters } = useQuery({
    queryKey: ['inventory', 'form-masters'],
    queryFn: () => listInventoryFormMasters(),
    enabled: open,
    staleTime: 60_000,
  })
  const { data: itemsList } = useQuery({
    queryKey: ['inventory', 'requisition-items'],
    queryFn: () => listItemsForRequisition(),
    enabled: open,
    staleTime: 60_000,
  })

  const [branchId, setBranchId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([newLine()])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setBranchId('')
      setNotes('')
      setLines([newLine()])
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  // Default the requesting branch to the user's first branch (a
  // branch-scoped outlet user has exactly one).
  useEffect(() => {
    if (open && masters?.branches[0] && !branchId) {
      setBranchId(masters.branches[0].id)
    }
  }, [open, masters, branchId])

  // Build a disambiguating sublabel (SKU · base unit · category) so
  // legitimately same-named items stay distinguishable in the dropdown
  // (e.g. raw "Green Tea" in grams next to packaged "Green Tea" in cup).
  const itemOptions = useMemo(
    () =>
      (itemsList ?? []).map((it) => {
        const parts = [
          it.sku ?? null,
          it.baseUnitLabel ?? null,
          it.categoryName ?? null,
        ].filter((p): p is string => !!p)
        return {
          value: it.id,
          label: it.name,
          hint: parts.length > 0 ? parts.join(' · ') : undefined,
        }
      }),
    [itemsList],
  )
  type RequisitionItem = NonNullable<typeof itemsList>[number]
  const itemById = useMemo(() => {
    const map = new Map<string, RequisitionItem>()
    for (const it of itemsList ?? []) map.set(it.id, it)
    return map
  }, [itemsList])

  function handlePickItem(rowKey: string, itemId: string) {
    const item = itemById.get(itemId)
    const defaultUnit =
      item?.units.find((u) => u.isDefault) ??
      item?.units.find((u) => u.ratioToBase === 1) ??
      item?.units[0]
    updateLine(rowKey, { itemId, unitId: defaultUnit?.unitId ?? '' })
  }

  function updateLine(rowKey: string, patch: Partial<DraftLine>) {
    setLines((p) => p.map((l) => (l.rowKey === rowKey ? { ...l, ...patch } : l)))
  }
  function removeLine(rowKey: string) {
    setLines((p) => p.filter((l) => l.rowKey !== rowKey))
  }

  async function submit() {
    setError(null)
    if (!branchId) {
      setError('Pilih cabang yang mengajukan permintaan.')
      return
    }
    const cleanLines = lines
      .map((l) => ({
        itemId: l.itemId,
        unitId: l.unitId || null,
        requestedQty: Number(l.requestedQty) || 0,
        notes: l.notes.trim() || null,
      }))
      .filter((l) => l.itemId && l.requestedQty > 0)
    if (cleanLines.length === 0) {
      setError('Tambahkan minimal 1 item dengan jumlah lebih dari 0.')
      return
    }

    setSubmitting(true)
    try {
      const created = await createRequisition({
        data: {
          requestingBranchId: branchId,
          notes: notes.trim() || null,
          lines: cleanLines,
        },
      })
      if (!created) throw new Error('Gagal membuat permintaan')
      toast({
        title: 'Permintaan stok dibuat',
        description: created.requisitionNumber,
        variant: 'success',
      })
      await onCreated(created.id)
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal menyimpan permintaan'
      setError(msg)
      toast({ title: 'Gagal', description: msg, variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Buat Permintaan Stok</SheetTitle>
        <SheetDescription>
          Ajukan permintaan stok dari cabang utama. Setelah disetujui dan
          dipenuhi, stok pindah otomatis ke cabang ini.
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Cabang pemohon *
            </label>
            <Select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[
                { value: '', label: 'Pilih cabang…' },
                ...(masters?.branches.map((b) => ({
                  value: b.id,
                  label: b.name,
                })) ?? []),
              ]}
            />
            <p className="mt-1 text-xs text-gray-500">
              Cabang utama akan otomatis jadi sumber pemenuhan.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Item yang diminta *
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
                        Baris {idx + 1}
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
                        placeholder="Pilih item…"
                        searchPlaceholder="Cari item…"
                        emptyResultLabel="Item tidak ditemukan"
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
                              updateLine(line.rowKey, {
                                unitId: e.target.value,
                              })
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
                      <div>
                        <label className="mb-0.5 block text-xs text-gray-500">
                          Jumlah diminta{unitLabel && ` (${unitLabel})`}
                        </label>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={line.requestedQty}
                          onChange={(e) =>
                            updateLine(line.rowKey, {
                              requestedQty: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((p) => [...p, newLine()])}
              className="mt-2 h-8 gap-1 px-2 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Baris
            </Button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Catatan
            </label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opsional…"
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
            Batal
          </Button>
          <Button type="submit" variant="brand" loading={submitting}>
            Kirim Permintaan
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
