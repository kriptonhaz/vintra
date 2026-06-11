import { DateInput } from '@/components/ui/date-input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  PRESET_LABEL,
  type Preset,
  type ReportFiltersState,
} from './use-report-filters'

/**
 * Date-preset chips + Dari/Sampai pickers + Cabang select. Extracted
 * from the inline filter row that used to live in
 * `_authed/pos/reports/index.tsx` so the four new report routes
 * (Kategori, Produk, Pelanggan, Diskon) can share a single source of
 * truth. State is owned by the parent via `useReportFilters()`.
 */
export function ReportFilterBar({
  state,
  branches,
}: {
  state: ReportFiltersState
  /** Cabang options. Pass empty array to render only the "Semua
   *  cabang" entry — used when masters haven't loaded yet. */
  branches: { id: string; name: string }[]
}) {
  const { preset, from, to, branchId, applyPreset, setFrom, setTo, setBranchId } =
    state
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              preset === p
                ? 'bg-brand-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600',
            )}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Dari
          </label>
          <DateInput value={from} onChange={setFrom} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Sampai
          </label>
          <DateInput value={to} onChange={setTo} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Cabang
          </label>
          <Select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[
              { value: '', label: 'Semua cabang' },
              ...branches.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </div>
      </div>
    </div>
  )
}
