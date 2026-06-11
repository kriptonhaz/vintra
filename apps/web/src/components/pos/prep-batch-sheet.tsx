import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChefHat, Loader2 } from 'lucide-react'
import { recordPrepBatch, listPrepBatches } from '@/server/functions/pos-prep'
import { formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

/**
 * Prep batch action sheet — shared between the cashier tile corner-`+`
 * action and the inventory item detail page.
 *
 * Caller passes the target item + branch + display unit. The sheet
 * handles its own state: qty input, optional notes, recent-prep tail,
 * mutation + toast + invalidate.
 *
 * On success it invalidates two query buckets so adjacent UI updates
 * within the same React Query cache:
 *   - ['pos', 'products', ...] so the cashier tile's Siap counter
 *     refreshes
 *   - ['prep-batches', ...] for the inventory detail "recent preps"
 *     list this sheet itself paints
 */
export interface PrepBatchSheetProps {
  open: boolean
  onClose: () => void
  item: {
    id: string
    name: string
  }
  branchId: string
  /**
   * The unit + ratio the cashier sees on the tile — what "1 prep" means
   * to the operator. Sheet shows the input next to this label and sends
   * `unitId` to the server fn so the server can convert to base.
   */
  unit: {
    id: string
    label: string
    ratioToBase: number
  }
}

export function PrepBatchSheet({
  open,
  onClose,
  item,
  branchId,
  unit,
}: PrepBatchSheetProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [qty, setQty] = React.useState<string>('')
  const [notes, setNotes] = React.useState<string>('')

  // Reset inputs when the sheet opens for a new item.
  React.useEffect(() => {
    if (open) {
      setQty('')
      setNotes('')
    }
  }, [open, item.id])

  const recent = useQuery({
    queryKey: ['prep-batches', item.id, branchId],
    queryFn: () =>
      listPrepBatches({
        data: { itemId: item.id, branchId, limit: 5 },
      }),
    enabled: open,
    staleTime: 30 * 1000,
  })

  const mutate = useMutation({
    mutationFn: () =>
      recordPrepBatch({
        data: {
          itemId: item.id,
          branchId,
          qty: Number(qty),
          unitId: unit.id,
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: (res) => {
      toast({
        title: 'Prep batch dicatat',
        description: `${qty} ${unit.label} ${item.name} siap disajikan.`,
        variant: 'success',
      })
      // Surface BOM warnings as a separate toast — don't let them
      // collide with the success message timing.
      const warnings = res?.warnings
      if (warnings && warnings.unlinkedMaterials.length > 0) {
        toast({
          title: 'Bahan tidak ter-link',
          description: `${warnings.unlinkedMaterials.length} bahan resep belum punya item inventaris: ${warnings.unlinkedMaterials.join(', ')}.`,
          variant: 'info',
        })
      }
      // Invalidate downstream caches so every Siap surface refreshes:
      //   - pos/products → cashier tile badge
      //   - prep-status   → inventory panel inline counter
      //   - prep-batches  → "recent preps" list inside this sheet (when
      //     it stays open) + the waste report page
      void queryClient.invalidateQueries({ queryKey: ['pos', 'products'] })
      void queryClient.invalidateQueries({ queryKey: ['prep-status'] })
      void queryClient.invalidateQueries({ queryKey: ['prep-batches'] })
      onClose()
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal mencatat prep',
        description: err.message,
        variant: 'error',
      })
    },
  })

  const qtyNum = Number(qty)
  const canSubmit =
    Number.isFinite(qtyNum) && qtyNum > 0 && !mutate.isPending

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Prep Batch</SheetTitle>
        <SheetDescription>
          Catat jumlah {item.name} yang sudah disiapkan. Bahan resep akan
          otomatis dikurangi dari inventaris.
        </SheetDescription>
      </SheetHeader>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) mutate.mutate()
        }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950/30">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
              <ChefHat className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {item.name}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Satuan prep: 1 {unit.label}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Jumlah disiapkan <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="misal 50"
                autoFocus
                className="flex-1"
              />
              <div className="grid place-items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {unit.label}
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Bahan resep akan langsung dikurangi dari stok inventaris.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Catatan (opsional)
            </label>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="misal: shift pagi"
              maxLength={500}
            />
          </div>

          {recent.data && recent.data.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Prep terakhir
              </p>
              <div className="space-y-1.5">
                {recent.data.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {formatDate(b.preparedAt, 'dd MMM, HH:mm')}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {formatNumberID(b.qtyConsumed)} /{' '}
                      {formatNumberID(b.qtyPrepared)} {b.baseUnitLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="brand" disabled={!canSubmit}>
            {mutate.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Menyimpan…
              </>
            ) : (
              'Simpan Prep'
            )}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
