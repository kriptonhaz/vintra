import * as React from 'react'
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  FileDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Single-button "Export" with a dropdown for Excel / CSV / PDF.
 * Mirrors the UX in `attendance/records.tsx` so every download
 * surface in the app behaves the same way — chevron toggle, outside-
 * click + Escape to close, icons + hint text per option, disabled
 * when there's nothing to export.
 */
export function ExportMenu({
  onXlsx,
  onCsv,
  onPdf,
  disabled = false,
  loading = false,
}: {
  onXlsx: () => void
  onCsv: () => void
  onPdf: () => void
  /** Hide the menu and disable the trigger — e.g. when the table is
   *  empty for the current range. */
  disabled?: boolean
  /** Spinner state on the trigger while an export is being prepared. */
  loading?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button
        variant="brand"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        loading={loading}
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <MenuItem
            icon={<FileSpreadsheet className="h-4 w-4 text-green-600 dark:text-green-400" />}
            label="Excel (XLSX)"
            hint="Pakai untuk diolah lagi di Excel atau Google Sheets."
            onClick={() => {
              setOpen(false)
              onXlsx()
            }}
          />
          <Divider />
          <MenuItem
            icon={<FileDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />}
            label="CSV"
            hint="Format teks ringan, kompatibel dengan banyak aplikasi."
            onClick={() => {
              setOpen(false)
              onCsv()
            }}
          />
          <Divider />
          <MenuItem
            icon={<FileText className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
            label="PDF"
            hint="Untuk dicetak atau dibagikan apa adanya."
            onClick={() => {
              setOpen(false)
              onPdf()
            }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      </div>
    </button>
  )
}

function Divider() {
  return <div className="h-px bg-gray-200 dark:bg-gray-700" />
}
