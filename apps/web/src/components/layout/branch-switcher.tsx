import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Check, ChevronDown } from 'lucide-react'
import { useBranch } from '@/hooks/use-branch'
import { cn } from '@/lib/utils'

/**
 * Global branch switcher in the topbar (Qasir-style). Role-adaptive:
 *   - single-branch tenant → renders nothing (no branch concept needed)
 *   - staff pinned to one branch of a multi-branch tenant → static
 *     label so they can see which outlet they're on, no dropdown
 *   - access to several branches → the dropdown
 *
 * The selection lives in BranchContext and is shared by every
 * branch-aware module.
 */
export function BranchSwitcher() {
  const { t } = useTranslation()
  const {
    branches,
    totalCount,
    selectedBranch,
    selectedBranchId,
    setSelectedBranchId,
  } = useBranch()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Single-branch tenant (or branches not yet loaded) — nothing to show.
  if (branches.length <= 1 && totalCount <= 1) return null

  // Branch-scoped staff: one accessible branch, but the tenant has more.
  // Show which outlet they're on; no switching.
  if (branches.length === 1) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300">
        <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
        <span className="max-w-[9rem] truncate font-medium">
          {branches[0]!.name}
        </span>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
        aria-label={t('branchSwitcher.label')}
      >
        <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
        <span className="max-w-[9rem] truncate font-medium">
          {selectedBranch?.name ?? t('branchSwitcher.select')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-80 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:shadow-gray-900/50">
          <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('branchSwitcher.label')}
          </p>
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => {
                setSelectedBranchId(branch.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                branch.id === selectedBranchId
                  ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
              )}
            >
              <span className="truncate">{branch.name}</span>
              {branch.id === selectedBranchId && (
                <Check className="h-4 w-4 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
