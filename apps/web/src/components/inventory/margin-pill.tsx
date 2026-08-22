import { cn } from '@/lib/utils'
import { getMarginLevel } from '@/lib/hpp-calculator'

interface MarginPillProps {
  /** Percent, or null when it cannot honestly be computed. */
  margin: number | null
  className?: string
}

/**
 * Margin of a single item, shown where its cost and price already are.
 *
 * Thresholds come from `getMarginLevel` rather than being restated here, so
 * a snack in Inventaris and a menu item in Laporan HPP are judged by the
 * same ruler. A loss is called "Rugi" — the same word the tier editor uses
 * on the item detail page — because a red "-8,3%" is a number to decode,
 * while "Rugi" is the thing the owner actually needs to know.
 *
 * Renders nothing when margin is null. An item with no buy price or no
 * selling price has no margin to report, and a placeholder on every such
 * row would be noise on exactly the rows that are still being set up.
 */
export function MarginPill({ margin, className }: MarginPillProps) {
  if (margin === null) return null

  const loss = margin < 0
  const level = getMarginLevel(margin)

  return (
    <span
      title={
        loss
          ? 'Harga jual di bawah modal — setiap penjualan menambah kerugian'
          : `Margin ${margin.toFixed(1)}% dari harga jual`
      }
      className={cn(
        'ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium',
        loss
          ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
          : level === 'danger'
            ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400'
            : level === 'warning'
              ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              : 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
        className,
      )}
    >
      {loss ? '⚠ Rugi' : `${margin.toFixed(1)}%`}
    </span>
  )
}
