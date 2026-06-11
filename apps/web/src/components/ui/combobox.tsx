import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyOptionLabel?: string
  searchPlaceholder?: string
  emptyResultLabel?: string
  error?: string
  disabled?: boolean
  className?: string
  id?: string
  clearable?: boolean
  /**
   * When supplied, the parent owns filtering — we forward the query and
   * trust `options` to reflect the server-side result. Skip the local
   * filter in this mode so a stale prefix doesn't double-filter.
   */
  onSearchChange?: (query: string) => void
  /** Show a "Memuat…" row instead of the filtered list. */
  loading?: boolean
}

/**
 * Searchable single-select. Use with React Hook Form's `Controller`.
 *
 * Behaves like `<Select>` but the trigger expands to a popover with a
 * filter input. Mobile-friendly: tappable rows, scrollable list.
 */
export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      value,
      onChange,
      options,
      placeholder = 'Pilih...',
      emptyOptionLabel,
      searchPlaceholder = 'Cari...',
      emptyResultLabel = 'Tidak ada hasil',
      error,
      disabled,
      className,
      id,
      clearable = true,
      onSearchChange,
      loading,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [activeIdx, setActiveIdx] = React.useState(0)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const listRef = React.useRef<HTMLUListElement>(null)
    const buttonId = id || React.useId()
    const serverSide = !!onSearchChange

    const selected = options.find((o) => o.value === value) ?? null

    const filtered = React.useMemo(() => {
      if (serverSide) return options
      const q = query.trim().toLowerCase()
      if (!q) return options
      return options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.hint?.toLowerCase().includes(q),
      )
    }, [options, query, serverSide])

    React.useEffect(() => {
      if (!open) return
      function onDocClick(e: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setOpen(false)
        }
      }
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }, [open])

    React.useEffect(() => {
      if (open) {
        setQuery('')
        setActiveIdx(0)
        // Focus the search input on open
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }, [open])

    React.useEffect(() => {
      // Keep the active option visible as the user navigates with keys.
      if (!open || !listRef.current) return
      const el = listRef.current.children[activeIdx] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }, [activeIdx, open])

    function handleSelect(opt: ComboboxOption) {
      if (opt.disabled) return
      onChange(opt.value)
      setOpen(false)
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const opt = filtered[activeIdx]
        if (opt) handleSelect(opt)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }

    const displayLabel =
      selected?.label ??
      (value === '' && emptyOptionLabel ? emptyOptionLabel : null)

    return (
      <div ref={containerRef} className="relative">
        <button
          ref={ref}
          id={buttonId}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm dark:bg-gray-800',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error
              ? 'border-danger-500 focus:ring-danger-500/25'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500/25 dark:border-gray-600',
            className,
          )}
        >
          <span
            className={cn(
              'truncate',
              displayLabel
                ? 'text-gray-900 dark:text-gray-100'
                : 'text-gray-400 dark:text-gray-500',
            )}
          >
            {displayLabel ?? placeholder}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1 text-gray-400">
            {clearable && value && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}
                className="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Hapus pilihan"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-100 p-2 dark:border-gray-700">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIdx(0)
                  onSearchChange?.(e.target.value)
                }}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
            <ul
              ref={listRef}
              role="listbox"
              className="max-h-60 overflow-y-auto py-1"
            >
              {loading ? (
                <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  Memuat…
                </li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {emptyResultLabel}
                </li>
              ) : (
                filtered.map((opt, i) => {
                  const isActive = i === activeIdx
                  const isSelected = opt.value === value
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => handleSelect(opt)}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                        opt.disabled && 'cursor-not-allowed opacity-50',
                        isActive && !opt.disabled
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                          : 'text-gray-700 dark:text-gray-200',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {opt.label}
                      </span>
                      {isSelected && (
                        <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                      )}
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        )}

        {error && (
          <p className="mt-1 text-sm text-danger-500">{error}</p>
        )}
      </div>
    )
  },
)
Combobox.displayName = 'Combobox'

// ───────────────────────────── multi ───────────────────────────────

interface MultiComboboxProps {
  values: string[]
  onChange: (values: string[]) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyResultLabel?: string
  error?: string
  disabled?: boolean
  className?: string
  id?: string
  /** Optional cap; selections beyond this are rejected. */
  maxSelection?: number
  /** Server-side filtering — parent owns the query → options mapping. */
  onSearchChange?: (query: string) => void
  loading?: boolean
}

/**
 * Searchable multi-select sibling of `Combobox`. Picked values render
 * as removable chips inside the trigger; the popover shows the filtered
 * option list with a checkmark on each selected row. Backspace on an
 * empty query pops the last chip (familiar UX).
 */
export const MultiCombobox = React.forwardRef<
  HTMLButtonElement,
  MultiComboboxProps
>(
  (
    {
      values,
      onChange,
      options,
      placeholder = 'Pilih...',
      searchPlaceholder = 'Cari...',
      emptyResultLabel = 'Tidak ada hasil',
      error,
      disabled,
      className,
      id,
      maxSelection,
      onSearchChange,
      loading,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [activeIdx, setActiveIdx] = React.useState(0)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const listRef = React.useRef<HTMLUListElement>(null)
    const buttonId = id || React.useId()
    const serverSide = !!onSearchChange

    const selectedSet = React.useMemo(() => new Set(values), [values])

    // Label cache: in server-side mode, the option list can swap as the
    // user types, so a previously-picked value may temporarily not be
    // present in `options`. Cache labels we've seen so chips still render
    // a name instead of a UUID.
    const [chipLabels, setChipLabels] = React.useState<Record<string, string>>(
      {},
    )
    React.useEffect(() => {
      setChipLabels((prev) => {
        const next = { ...prev }
        for (const o of options) next[o.value] = o.label
        return next
      })
    }, [options])

    const filtered = React.useMemo(() => {
      if (serverSide) return options
      const q = query.trim().toLowerCase()
      if (!q) return options
      return options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.hint?.toLowerCase().includes(q),
      )
    }, [options, query, serverSide])

    React.useEffect(() => {
      if (!open) return
      function onDocClick(e: MouseEvent) {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setOpen(false)
        }
      }
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }, [open])

    React.useEffect(() => {
      if (open) {
        setQuery('')
        setActiveIdx(0)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }, [open])

    React.useEffect(() => {
      if (!open || !listRef.current) return
      const el = listRef.current.children[activeIdx] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }, [activeIdx, open])

    const atCap =
      typeof maxSelection === 'number' && values.length >= maxSelection

    function toggle(opt: ComboboxOption) {
      if (opt.disabled) return
      if (selectedSet.has(opt.value)) {
        onChange(values.filter((v) => v !== opt.value))
      } else {
        if (atCap) return
        onChange([...values, opt.value])
      }
      // Keep the popover open — multi-select is faster when consecutive
      // picks don't require reopening.
      inputRef.current?.focus()
    }

    function remove(v: string) {
      onChange(values.filter((x) => x !== v))
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const opt = filtered[activeIdx]
        if (opt) toggle(opt)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      } else if (e.key === 'Backspace' && query === '' && values.length > 0) {
        remove(values[values.length - 1]!)
      }
    }

    return (
      <div ref={containerRef} className="relative">
        <button
          ref={ref}
          id={buttonId}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={error ? 'true' : undefined}
          className={cn(
            'flex min-h-10 w-full flex-wrap items-center gap-1 rounded-lg border bg-white px-2 py-1 text-left text-sm dark:bg-gray-800',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error
              ? 'border-danger-500 focus:ring-danger-500/25'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500/25 dark:border-gray-600',
            className,
          )}
        >
          {values.length === 0 ? (
            <span className="px-1 text-gray-400 dark:text-gray-500">
              {placeholder}
            </span>
          ) : (
            values.map((v) => (
              <span
                key={v}
                className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
              >
                {chipLabels[v] ?? v}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Hapus"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(v)
                  }}
                  className="rounded text-brand-700/70 hover:text-brand-900 dark:text-brand-400/70 dark:hover:text-brand-200"
                >
                  <X className="h-3 w-3" />
                </span>
              </span>
            ))
          )}
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-gray-400" />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-100 p-2 dark:border-gray-700">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIdx(0)
                  onSearchChange?.(e.target.value)
                }}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
            <ul
              ref={listRef}
              role="listbox"
              className="max-h-60 overflow-y-auto py-1"
            >
              {loading ? (
                <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  Memuat…
                </li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {emptyResultLabel}
                </li>
              ) : (
                filtered.map((opt, i) => {
                  const isActive = i === activeIdx
                  const isSelected = selectedSet.has(opt.value)
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => toggle(opt)}
                      className={cn(
                        'flex cursor-pointer items-start justify-between gap-2 px-3 py-2 text-sm',
                        opt.disabled && 'cursor-not-allowed opacity-50',
                        isActive && !opt.disabled
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                          : 'text-gray-700 dark:text-gray-200',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{opt.label}</p>
                        {opt.hint && (
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {opt.hint}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                      )}
                    </li>
                  )
                })
              )}
              {atCap && (
                <li className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500 dark:border-gray-700">
                  Maksimal {maxSelection} pilihan.
                </li>
              )}
            </ul>
          </div>
        )}

        {error && <p className="mt-1 text-sm text-danger-500">{error}</p>}
      </div>
    )
  },
)
MultiCombobox.displayName = 'MultiCombobox'
