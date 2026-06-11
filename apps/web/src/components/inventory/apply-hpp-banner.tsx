import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, X } from 'lucide-react'
import {
  applyHppPriceToInventory,
  previewLinkedItemsForMaterial,
} from '@/server/functions/inventory'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'

/**
 * Inline banner shown on the inventory items list when arriving via
 * `?applyHpp=<materialId>` (deeplinked from the
 * `inventory_hpp_cost_changed` notification).
 *
 * Surfaces the change at a glance — material name, new price, count
 * of linked items that would be touched (skipping items with
 * `autoSyncHppCost=false`) — and offers a single "Terapkan" button
 * that bulk-updates `cost_price`.
 *
 * Doesn't render anything once dismissed or fully applied; the parent
 * controls visibility via `onDismiss`.
 */
export function ApplyHppBanner({
  materialId,
  onDismiss,
  onApplied,
}: {
  materialId: string
  onDismiss: () => void
  onApplied: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [applying, setApplying] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['inventory', 'apply-hpp-preview', materialId],
    queryFn: () =>
      previewLinkedItemsForMaterial({ data: { materialId } }),
    staleTime: 30_000,
  })

  if (isLoading) return null
  if (error || !data) return null

  const eligible = data.items.filter((it) => it.autoSyncHppCost)
  const skipped = data.items.length - eligible.length
  const noChange = eligible.every(
    (it) => it.currentCost === data.material.pricePerUnit,
  )

  // Nothing to do — every linked item is either toggled off or
  // already at the new price. Show a soft "all in sync" state with
  // just a dismiss; saves the user a redundant click.
  if (data.items.length === 0 || noChange) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('inventory.applyHppNoChange', {
            material: data.material.name,
          })}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  async function apply() {
    setApplying(true)
    try {
      const res = await applyHppPriceToInventory({
        data: { materialId },
      })
      toast({
        title: t('common.toastSavedTitle'),
        description: t('inventory.applyHppToast', {
          count: res.updatedCount,
        }),
        variant: 'success',
      })
      await onApplied()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-brand-300 bg-brand-50 p-4 dark:border-brand-900/50 dark:bg-brand-900/10 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400">
          <TrendingUp className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-brand-900 dark:text-brand-200">
            {t('inventory.applyHppTitle', { material: data.material.name })}
          </p>
          <p className="mt-0.5 text-sm text-brand-800 dark:text-brand-300">
            {t('inventory.applyHppBody', {
              price: formatRupiah(data.material.pricePerUnit),
              unit: data.material.unit,
              count: eligible.length,
            })}
            {skipped > 0 && (
              <span className="ml-1 text-xs text-warning-700 dark:text-warning-400">
                ({t('inventory.applyHppSkipped', { count: skipped })})
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onDismiss}
          disabled={applying}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="brand"
          onClick={apply}
          loading={applying}
          disabled={eligible.length === 0}
        >
          {t('inventory.applyHppCta')}
        </Button>
      </div>
    </div>
  )
}
