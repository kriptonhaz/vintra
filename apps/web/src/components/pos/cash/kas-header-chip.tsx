import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Wallet, MoreVertical, Banknote, Receipt, Lock } from 'lucide-react'
import { formatRupiah } from '@/lib/currency'
import { cn } from '@/lib/utils'

/**
 * JUR-141 Peti Kas — the always-visible header chip on /pos/cashier
 * once a session is open. Shows the live running balance + a ⋮ menu
 * for Setor / Tarik / Tutup.
 *
 * The chip is a button — clicking the body opens the same menu as
 * the dots, to make the click target generous on mobile.
 */
export function KasHeaderChip({
  runningBalance,
  onSetor,
  onTarik,
  onTutup,
}: {
  runningBalance: number
  onSetor: () => void
  onTarik: () => void
  onTutup: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  // Outside-click dismiss — same pattern as the JUR-135 chip editor.
  React.useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function pick(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-100 dark:border-brand-700/40 dark:bg-brand-900/30 dark:text-brand-300',
          open && 'ring-2 ring-brand-400',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Wallet className="h-4 w-4" />
        <span className="tabular-nums">{formatRupiah(runningBalance)}</span>
        <MoreVertical className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => pick(onSetor)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Banknote className="h-4 w-4 text-gray-400" />
            {t('pos.cash.header.menuSetor')}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => pick(onTarik)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Receipt className="h-4 w-4 text-gray-400" />
            {t('pos.cash.header.menuTarik')}
          </button>
          <div className="border-t border-gray-100 dark:border-gray-700" />
          <button
            role="menuitem"
            type="button"
            onClick={() => pick(onTutup)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-danger-700 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-900/30"
          >
            <Lock className="h-4 w-4" />
            {t('pos.cash.header.menuTutup')}
          </button>
        </div>
      )}
    </div>
  )
}
