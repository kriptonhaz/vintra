import * as React from 'react'
import { cn } from '@/lib/utils'

export type ReportColumn<Row> = {
  key: string
  header: string
  /** Cell renderer — receives the full row so the column can pull
   *  multiple fields (e.g. a customer cell that shows name on top of
   *  phone). Returns a React node. */
  cell: (row: Row) => React.ReactNode
  /** Used for right-aligning numeric columns. Defaults to 'left'. */
  align?: 'left' | 'right'
  /** Tailwind width class for the table column (e.g. 'w-28'). Optional
   *  — leave undefined for auto-sized columns. */
  width?: string
  /** Hide this column from the mobile card stack (e.g. an SKU column
   *  too dense for a phone). The table view always shows everything. */
  hideOnMobile?: boolean
}

/**
 * Renders a real `<table>` at `sm+` and a stacked label/value card
 * list at narrow widths. The mobile path uses the column's `header`
 * as the field label and `cell(row)` as the value so callers don't
 * have to author two layouts. Card-stack chosen over horizontal
 * scroll per the project's mobile-first preference (see plan).
 *
 * Empty state: pass `emptyMessage` instead of writing a custom
 * fallback at every call site.
 */
export function ReportTable<Row>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'Tidak ada data.',
  className,
}: {
  columns: ReportColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  emptyMessage?: string
  className?: string
}) {
  if (rows.length === 0) {
    return (
      <p className={cn('p-5 text-sm text-gray-500', className)}>
        {emptyMessage}
      </p>
    )
  }
  return (
    <div className={className}>
      {/* Desktop / tablet: real table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full caption-bottom text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    c.width,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 dark:border-gray-700/40 dark:hover:bg-gray-700/30"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100',
                      c.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile: stacked label/value card per row */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((row, i) => (
          <li
            key={rowKey(row, i)}
            className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            {columns
              .filter((c) => !c.hideOnMobile)
              .map((c, idx) => (
                <div
                  key={c.key}
                  className={cn(
                    'flex items-baseline justify-between gap-3 text-sm',
                    idx > 0 && 'mt-1',
                  )}
                >
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {c.header}
                  </span>
                  <span className="min-w-0 truncate text-right text-gray-900 dark:text-gray-100">
                    {c.cell(row)}
                  </span>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
