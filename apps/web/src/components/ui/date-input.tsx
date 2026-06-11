import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Indonesian-format date input. Native `<input type="date">` renders
 * mm/dd/yyyy on en-US-locale browsers — Indonesian users (the
 * audience) mis-read that as a different date, so we render a text
 * input with a strict dd/mm/yyyy mask AND a calendar-icon popover for
 * point-and-click entry. Either path emits the same ISO value.
 *
 * The on-the-wire value is still ISO `yyyy-mm-dd` (or empty) — same
 * contract as the native date input — so existing zod schemas
 * (`isIsoDate`, etc.) and server functions don't change. Wrap in
 * react-hook-form's `<Controller>` when binding to a registered field.
 *
 * The label / error wrapper mirrors `<Input>` so this is a drop-in
 * replacement: rename `Input` → `DateInput`, drop `type="date"`, and
 * change `onChange={(e) => setX(e.target.value)}` to `onChange={setX}`.
 */

interface DateInputProps {
  /** ISO `yyyy-mm-dd`, or empty string when unset. */
  value: string
  /** Receives ISO `yyyy-mm-dd`, or '' when cleared / not yet valid. */
  onChange: (iso: string) => void
  onBlur?: () => void
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
  name?: string
  label?: string
  error?: string
  /** ISO `yyyy-mm-dd` upper bound (inclusive) — dates after this don't emit. */
  max?: string
  /** ISO `yyyy-mm-dd` lower bound (inclusive). */
  min?: string
  required?: boolean
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const ID_WEEKDAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

/** `yyyy-mm-dd` → `dd/mm/yyyy`; `''` for anything malformed. */
function formatDisplay(iso: string): string {
  const m = ISO_RE.exec(iso)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Insert slashes as the user types: `12032025` → `12/03/2025`. */
function autoFormat(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/**
 * `dd/mm/yyyy` → ISO `yyyy-mm-dd`. Returns `''` for an incomplete or
 * invalid input — the parent form should treat that as "no value yet"
 * (matches the contract of an empty native date input).
 */
function parseDisplay(text: string): string {
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 8) return ''
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  const d = Number(dd)
  const m = Number(mm)
  const y = Number(yyyy)
  if (m < 1 || m > 12) return ''
  if (d < 1 || d > 31) return ''
  if (y < 1900 || y > 2100) return ''
  // Round-trip through Date to reject impossibles like 31/02 (the JS
  // Date constructor would silently roll it to 03/03 — we don't want
  // that, so we verify the parts survived intact).
  const date = new Date(y, m - 1, d)
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return ''
  }
  return `${yyyy}-${mm}-${dd}`
}

/** Pad helper for building ISO strings from numeric parts. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function isoFor(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

function todayIso(): string {
  const now = new Date()
  return isoFor(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Build the 6×7 calendar grid for `(viewYear, viewMonth)`. Cells before
 * day-1 / after the last day are returned as `null` so the renderer
 * can show blanks without juggling indices.
 */
function buildGrid(viewYear: number, viewMonth: number): Array<number | null> {
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: Array<number | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length < 42) cells.push(null)
  return cells
}

export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  function DateInput(
    {
      value,
      onChange,
      onBlur,
      disabled,
      placeholder,
      className,
      id,
      name,
      label,
      error,
      max,
      min,
      required,
    },
    ref,
  ) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const [text, setText] = useState(() => formatDisplay(value))
    const [pickerOpen, setPickerOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // The calendar view always starts on the bound value's month when
    // there is one, falling back to today. Re-syncs when the bound
    // value changes externally (form reset, async load).
    const initialView = () => {
      const m = ISO_RE.exec(value)
      if (m) return { year: Number(m[1]), month: Number(m[2]) - 1 }
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() }
    }
    const [view, setView] = useState(initialView)

    // Re-sync the displayed text whenever the bound value changes
    // externally (form reset, async load, server roundtrip). The
    // string compare prevents an infinite render loop with RHF.
    useEffect(() => {
      const next = formatDisplay(value)
      if (next !== text) setText(next)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    // Whenever the popover (re)opens, jump the view back to the bound
    // value's month so the user always starts from "where they are".
    useEffect(() => {
      if (!pickerOpen) return
      const m = ISO_RE.exec(value)
      if (m) setView({ year: Number(m[1]), month: Number(m[2]) - 1 })
    }, [pickerOpen, value])

    // Outside-click closes the popover. Same pattern as Combobox.
    useEffect(() => {
      if (!pickerOpen) return
      function onDocClick(e: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setPickerOpen(false)
        }
      }
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }, [pickerOpen])

    function commitPicked(iso: string) {
      if (max && iso > max) return
      if (min && iso < min) return
      setText(formatDisplay(iso))
      onChange(iso)
      setPickerOpen(false)
    }

    function shiftMonth(delta: number) {
      setView((v) => {
        const total = v.year * 12 + v.month + delta
        return { year: Math.floor(total / 12), month: total % 12 }
      })
    }

    const today = todayIso()
    const grid = buildGrid(view.year, view.month)

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </label>
        )}
        <div ref={containerRef} className="relative">
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            placeholder={placeholder ?? 'dd/mm/yyyy'}
            disabled={disabled}
            required={required}
            name={name}
            maxLength={10}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={(e) => {
              const formatted = autoFormat(e.target.value)
              setText(formatted)
              // Emit ISO only once the input parses cleanly AND lands
              // inside the optional [min, max] window; otherwise '' so
              // the form sees no value until a real, in-range date is
              // typed. ISO strings compare lexicographically correctly.
              const iso = parseDisplay(formatted)
              if (!iso) {
                onChange('')
                return
              }
              if (max && iso > max) {
                onChange('')
                return
              }
              if (min && iso < min) {
                onChange('')
                return
              }
              onChange(iso)
            }}
            onBlur={onBlur}
            className={cn(
              'flex h-10 w-full rounded-lg border bg-white pl-3 pr-10 py-2 text-sm dark:bg-gray-800',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error
                ? 'border-danger-500 focus:ring-danger-500/25'
                : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500/25 dark:border-gray-600',
              className,
            )}
          />
          <button
            type="button"
            aria-label="Buka kalender"
            disabled={disabled}
            onClick={() => setPickerOpen((o) => !o)}
            className={cn(
              'absolute inset-y-0 right-0 flex items-center justify-center px-2.5',
              'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:rounded-r-lg',
            )}
          >
            <CalendarIcon className="h-4 w-4" />
          </button>

          {pickerOpen && !disabled && (
            <div
              role="dialog"
              aria-label="Pilih tanggal"
              className={cn(
                'absolute z-20 mt-1 w-72 overflow-hidden rounded-lg border bg-white p-2 shadow-lg',
                'border-gray-200 dark:border-gray-700 dark:bg-gray-800',
              )}
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <button
                  type="button"
                  aria-label="Bulan sebelumnya"
                  onClick={() => shiftMonth(-1)}
                  className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {ID_MONTHS[view.month]} {view.year}
                </p>
                <button
                  type="button"
                  aria-label="Bulan berikutnya"
                  onClick={() => shiftMonth(1)}
                  className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-1 pb-1 text-center text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {ID_WEEKDAYS_SHORT.map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-1 pb-1">
                {grid.map((day, i) => {
                  if (day == null) return <div key={i} className="h-8" />
                  const iso = isoFor(view.year, view.month, day)
                  const isSelected = iso === value
                  const isToday = iso === today
                  const outOfRange =
                    (max != null && iso > max) || (min != null && iso < min)
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={outOfRange}
                      onClick={() => commitPicked(iso)}
                      className={cn(
                        'h-8 rounded-md text-xs tabular-nums transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                        outOfRange
                          ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                          : isSelected
                            ? 'bg-brand-600 font-semibold text-white hover:bg-brand-700'
                            : isToday
                              ? 'bg-brand-50 font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300'
                              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
                      )}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => commitPicked(today)}
                  disabled={
                    (max != null && today > max) ||
                    (min != null && today < min)
                  }
                  className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-brand-400 dark:hover:bg-brand-900/30"
                >
                  Hari ini
                </button>
                {value && (
                  <button
                    type="button"
                    onClick={() => {
                      setText('')
                      onChange('')
                      setPickerOpen(false)
                    }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Hapus
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-danger-500">
            {error}
          </p>
        )}
      </div>
    )
  },
)
