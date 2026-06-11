import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Search, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SupplierOption {
  id: string
  name: string
}

interface SupplierComboboxProps {
  value: string
  onChange: (value: string) => void
  onSelect?: (supplier: SupplierOption) => void
  suppliers: SupplierOption[]
  error?: string
  placeholder?: string
  className?: string
  readOnly?: boolean
  /** When true, hides the "create new" row — user must pick from the list */
  disableCreate?: boolean
}

export function SupplierCombobox({
  value,
  onChange,
  onSelect,
  suppliers,
  error,
  placeholder = 'Cari atau ketik supplier',
  className,
  readOnly,
  disableCreate = false,
}: SupplierComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) => s.name.toLowerCase().includes(q))
  }, [value, suppliers])

  const hasExactMatch = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return false
    return suppliers.some((s) => s.name.toLowerCase() === q)
  }, [value, suppliers])

  useEffect(() => {
    setHighlightIndex(-1)
  }, [filtered.length])

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-combobox-item]')
      items[highlightIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const handleSelect = useCallback(
    (supplier: SupplierOption) => {
      onChange(supplier.name)
      onSelect?.(supplier)
      setOpen(false)
      setHighlightIndex(-1)
    },
    [onSelect, onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          setOpen(true)
          e.preventDefault()
        }
        return
      }

      const totalItems = filtered.length + (value.trim() && !hasExactMatch ? 1 : 0)

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightIndex((prev) =>
            prev < totalItems - 1 ? prev + 1 : 0,
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : totalItems - 1,
          )
          break
        case 'Enter':
          e.preventDefault()
          if (highlightIndex >= 0 && highlightIndex < filtered.length) {
            handleSelect(filtered[highlightIndex]!)
          } else {
            setOpen(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          setHighlightIndex(-1)
          break
      }
    },
    [open, filtered, highlightIndex, handleSelect, value, hasExactMatch],
  )

  const showDropdown = open && !readOnly && (filtered.length > 0 || value.trim())

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => { if (!readOnly) setOpen(true) }}
          onBlur={() => {
            setTimeout(() => setOpen(false), 200)
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm dark:border-gray-600 dark:bg-gray-800',
            'focus:border-brand-300 focus:ring-1 focus:ring-brand-300 focus:outline-none',
            readOnly && 'cursor-default border-transparent bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400',
            error && 'border-danger-500',
          )}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>

      {error && (
        <p className="mt-1 text-xs text-danger-500">{error}</p>
      )}

      {showDropdown && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:shadow-gray-900/50"
        >
          {filtered.map((supplier, idx) => (
            <button
              key={supplier.id}
              data-combobox-item
              type="button"
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm',
                highlightIndex === idx
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(supplier)}
              onMouseEnter={() => setHighlightIndex(idx)}
            >
              <span className="truncate">{supplier.name}</span>
            </button>
          ))}

          {value.trim() && !hasExactMatch && !disableCreate && (
            <div
              data-combobox-item
              className={cn(
                'flex items-center gap-2 border-t border-gray-100 px-3 py-2 text-sm dark:border-gray-700',
                highlightIndex === filtered.length
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'text-gray-500 dark:text-gray-400',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                Supplier baru "<strong>{value.trim()}</strong>"
              </span>
            </div>
          )}

          {value.trim() && filtered.length === 0 && disableCreate && (
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              Supplier tidak ditemukan. Tambahkan di halaman Supplier & Bahan Baku.
            </div>
          )}

          {filtered.length === 0 && !value.trim() && (
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              Belum ada data supplier
            </div>
          )}
        </div>
      )}
    </div>
  )
}
