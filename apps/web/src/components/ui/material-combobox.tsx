import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Search, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRupiahDecimal } from '@/lib/currency'

export interface MaterialOption {
  id: string
  name: string
  brand: string | null
  unit: string
  pricePerUnit: string
  supplierId: string | null
  supplierName: string | null
}

export interface ProductOption {
  id: string
  name: string
  hpp: number
  unit: string
}

interface MaterialComboboxProps {
  value: string
  onChange: (value: string) => void
  onSelect: (material: MaterialOption) => void
  materials: MaterialOption[]
  /** Existing products with calculated HPP */
  products?: ProductOption[]
  /** Called when a product is selected instead of a material */
  onSelectProduct?: (product: ProductOption) => void
  error?: string
  placeholder?: string
  className?: string
  /** When true, hides the "create new" row — user must pick from the list */
  disableCreate?: boolean
}

export function MaterialCombobox({
  value,
  onChange,
  onSelect,
  materials,
  products = [],
  onSelectProduct,
  error,
  placeholder = 'Cari atau ketik nama bahan',
  className,
  disableCreate = false,
}: MaterialComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredMaterials = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return materials
    return materials.filter((m) => {
      const label = [m.name, m.brand, m.supplierName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return label.includes(q)
    })
  }, [value, materials])

  const filteredProducts = useMemo(() => {
    if (products.length === 0) return []
    const q = value.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => p.name.toLowerCase().includes(q))
  }, [value, products])

  const totalSelectableItems = filteredMaterials.length + filteredProducts.length

  const hasExactMatch = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return false
    return (
      materials.some((m) => m.name.toLowerCase() === q) ||
      products.some((p) => p.name.toLowerCase() === q)
    )
  }, [value, materials, products])

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(-1)
  }, [totalSelectableItems])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-combobox-item]')
      items[highlightIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const handleSelectMaterial = useCallback(
    (material: MaterialOption) => {
      onChange(material.name)
      onSelect(material)
      setOpen(false)
      setHighlightIndex(-1)
    },
    [onSelect, onChange],
  )

  const handleSelectProduct = useCallback(
    (product: ProductOption) => {
      onChange(product.name)
      onSelectProduct?.(product)
      setOpen(false)
      setHighlightIndex(-1)
    },
    [onSelectProduct, onChange],
  )

  const showCreateRow = value.trim() && !hasExactMatch && !disableCreate
  const totalNavigableItems = totalSelectableItems + (showCreateRow ? 1 : 0)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          setOpen(true)
          e.preventDefault()
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightIndex((prev) =>
            prev < totalNavigableItems - 1 ? prev + 1 : 0,
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : totalNavigableItems - 1,
          )
          break
        case 'Enter':
          e.preventDefault()
          if (highlightIndex >= 0 && highlightIndex < filteredMaterials.length) {
            handleSelectMaterial(filteredMaterials[highlightIndex]!)
          } else if (
            highlightIndex >= filteredMaterials.length &&
            highlightIndex < totalSelectableItems
          ) {
            const productIdx = highlightIndex - filteredMaterials.length
            handleSelectProduct(filteredProducts[productIdx]!)
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
    [open, filteredMaterials, filteredProducts, highlightIndex, handleSelectMaterial, handleSelectProduct, totalNavigableItems, totalSelectableItems],
  )

  const showDropdown = open && (totalSelectableItems > 0 || value.trim())

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay to allow click on dropdown items
            setTimeout(() => setOpen(false), 200)
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2.5 text-sm dark:border-gray-600 dark:bg-gray-800',
            'focus:border-brand-300 focus:ring-1 focus:ring-brand-300 focus:outline-none',
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
          // Pinned to the LEFT of the trigger only — releasing `right-0`
          // lets the panel grow past the narrow item/bahan column. Fixed
          // 24rem (~384px) so material names + "@ Rp x/unit" suffix fit
          // without truncation, clamped to viewport width on mobile.
          className="absolute left-0 z-30 mt-1 max-h-60 w-96 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:shadow-gray-900/50"
        >
          {/* Bahan Baku section */}
          {filteredMaterials.length > 0 && (
            <>
              {filteredProducts.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Bahan Baku
                </div>
              )}
              {filteredMaterials.map((material, idx) => {
                const label = [
                  material.name,
                  material.brand && `- ${material.brand}`,
                  material.supplierName && `(${material.supplierName})`,
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <button
                    key={material.id}
                    data-combobox-item
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                      highlightIndex === idx
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectMaterial(material)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                  >
                    <span className="truncate">{label}</span>
                    <span className="ml-2 shrink-0 text-xs text-gray-400 dark:text-gray-500">
                      @ {formatRupiahDecimal(parseFloat(material.pricePerUnit) || 0)}/{material.unit}
                    </span>
                  </button>
                )
              })}
            </>
          )}

          {/* Produk section */}
          {filteredProducts.length > 0 && (
            <>
              <div className={cn(
                'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500',
                filteredMaterials.length > 0 && 'border-t border-gray-100 dark:border-gray-700',
              )}>
                Produk
              </div>
              {filteredProducts.map((product, idx) => {
                const globalIdx = filteredMaterials.length + idx

                return (
                  <button
                    key={product.id}
                    data-combobox-item
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                      highlightIndex === globalIdx
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectProduct(product)}
                    onMouseEnter={() => setHighlightIndex(globalIdx)}
                  >
                    <span className="truncate">{product.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-gray-400 dark:text-gray-500">
                      HPP {formatRupiahDecimal(product.hpp)}/{product.unit}
                    </span>
                  </button>
                )
              })}
            </>
          )}

          {/* Create new row */}
          {showCreateRow && (
            <div
              data-combobox-item
              className={cn(
                'flex items-center gap-2 border-t border-gray-100 px-3 py-2 text-sm dark:border-gray-700',
                highlightIndex === totalSelectableItems
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                  : 'text-gray-500 dark:text-gray-400',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                Bahan baru "<strong>{value.trim()}</strong>" — data akan dibuat
                otomatis saat disimpan
              </span>
            </div>
          )}

          {/* Not found messages */}
          {value.trim() && totalSelectableItems === 0 && disableCreate && (
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              Bahan baku atau produk tidak ditemukan. Tambahkan di halaman Supplier & Bahan Baku.
            </div>
          )}

          {totalSelectableItems === 0 && !value.trim() && (
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              Belum ada data bahan baku
            </div>
          )}
        </div>
      )}
    </div>
  )
}
