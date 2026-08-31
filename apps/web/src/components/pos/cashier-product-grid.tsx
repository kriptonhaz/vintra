import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Package, Plus, Star, X } from 'lucide-react'
import { listPOSProducts, getPOSCashierMasters } from '@/server/functions/pos'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRupiah } from '@/lib/currency'
import { cn, formatNumberID } from '@/lib/utils' // JUR-137: formatNumberID for stable SSR/client

export interface POSProductUnit {
  unitId: string
  unitLabel: string
  ratioToBase: number
  /** True for the unit admin pinned as the cashier-card display unit. */
  isDefault: boolean
  tiers: Array<{ minQty: number; unitPrice: number }>
}

export interface POSProduct {
  id: string
  name: string
  sku: string | null
  baseUnitId: string
  baseUnitLabel: string
  photoKey: string | null
  /** Short-lived signed GET URL for the photo (server-signed in listPOSProducts). */
  photoUrl?: string | null
  categoryId: string | null
  /** Stock at this branch, expressed in BASE units. */
  stockInBase: number
  /**
   * Service-mode flag. True when this item links to a recipe-backed
   * HPP product — it has no own stock balance, the cashier sees an
   * "Auto" badge instead of "Stok: N", and the sale path deducts BOM
   * ingredients (not the item itself). Defaults false for backwards-
   * compatibility with older listPOSProducts callers.
   */
  recipeBacked?: boolean
  /**
   * False for consignment goods — no balance is kept, so the tile shows
   * "Titipan" instead of a count and never gates on stock.
   */
  trackStock?: boolean
  /**
   * Prep-mode flag (JUR-15). When true, the tile shows a "Siap: N"
   * badge instead of "Auto" and hard-disables when siapInBase = 0 —
   * the BOM was already deducted at "Prep batch" time, so the sale
   * just consumes a counter that the operator refills explicitly.
   */
  prepMode?: boolean
  /**
   * Current Siap counter for prep-mode items, in BASE units. Null for
   * non-prep items. The tile converts to display unit at render time.
   */
  siapInBase?: number | null
  /**
   * Pin-to-top flag. The server already orders favorites first when
   * the category filter is "Semua"; the tile renders a small star
   * badge so the cashier can see which items are explicit favorites.
   */
  isFavorite?: boolean
  /** Every priced unit. Always at least 1; the cashier picks one when adding. */
  units: POSProductUnit[]
  /** True when the item is sold as one of its variants (Phase 3). */
  hasVariants?: boolean
  /** Variant combinations with per-branch stock + price. */
  variants?: POSVariant[]
}

export interface POSVariant {
  id: string
  value1: string
  value2: string
  label: string
  sku: string | null
  price: number
  /** Variant stock at this branch, in base units. */
  stockInBase: number
}

interface Props {
  branchId: string
  onAdd: (product: POSProduct) => void
  /**
   * When set, prep-mode tiles render a corner `+` button that calls
   * back with the tapped product so the caller can open a prep batch
   * sheet. Omit to hide the button (e.g. for read-only viewers).
   */
  onPrepBatch?: (product: POSProduct) => void
  cartItemIds: Set<string>
  /**
   * Slot rendered on the right of the search input — the cashier uses
   * it for the Peti Kas pill so the chip shares a row with search
   * instead of taking a header row of its own.
   */
  headerRight?: React.ReactNode
}

export function CashierProductGrid({
  branchId,
  onAdd,
  onPrepBatch,
  cartItemIds,
  headerRight,
}: Props) {
  const [search, setSearch] = React.useState('')
  // Held so clearing can hand focus straight back. On a phone that is
  // the whole point: losing focus dismisses the keyboard, and the
  // cashier has to tap the field again before typing the next item.
  const searchRef = React.useRef<HTMLInputElement>(null)
  const [categoryId, setCategoryId] = React.useState<string | null>(null)

  const masters = useQuery({
    queryKey: ['pos', 'cashier-masters', branchId],
    queryFn: () => getPOSCashierMasters({ data: { branchId } }),
    staleTime: 60 * 1000,
  })

  // Cashier products + stock change frequently (every sale, every
  // stock-in, every price edit). Treat the cache as always-stale so
  // the list refreshes on tab focus + on every navigation back to
  // the cashier. This catches the common "edit price in inventory →
  // come back to cashier" flow without requiring a hard reload.
  const products = useQuery({
    queryKey: ['pos', 'products', branchId, search, categoryId],
    queryFn: () =>
      listPOSProducts({
        data: {
          branchId,
          search: search || undefined,
          categoryId: categoryId ?? undefined,
          page: 1,
          pageSize: 100,
        },
      }),
    enabled: Boolean(branchId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  })

  const items = (products.data?.items ?? []) as POSProduct[]

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari produk atau SKU…"
              // Right padding only while the clear button is there, so
              // the placeholder keeps the full width when it is not.
              className={cn('pl-9', search && 'pr-10')}
            />
            {search && (
              /* One tap to start the next item. Ringing up two products
                 means clearing a whole product name between them, which
                 on a phone keyboard is a dozen backspaces. */
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  searchRef.current?.focus()
                }}
                aria-label="Hapus pencarian"
                className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
        {masters.data && masters.data.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              active={categoryId === null}
              onClick={() => setCategoryId(null)}
            >
              Semua
            </CategoryChip>
            {masters.data.categories.map((c) => (
              <CategoryChip
                key={c.id}
                active={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </CategoryChip>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex-1 overflow-y-auto">
        {products.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-gray-500">
            <Package className="mb-2 h-8 w-8 text-gray-300" />
            <p>
              {search
                ? 'Tidak ada produk cocok'
                : 'Belum ada produk dengan harga jual. Atur tier harga di Inventory.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                inCart={cartItemIds.has(p.id)}
                onAdd={() => onAdd(p)}
                onPrepBatch={onPrepBatch ? () => onPrepBatch(p) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Product card. Shows the cheapest tier-1 price across all units +
 * the largest configured unit's stock (e.g. "1.5 kg" rather than
 * "1500 gram") so the cashier reads it the way the customer asks for
 * it. The detail of unit/qty/tier picking happens in a popup modal
 * triggered by tapping the card.
 */
function ProductCard({
  product,
  inCart,
  onAdd,
  onPrepBatch,
}: {
  product: POSProduct
  inCart: boolean
  onAdd: () => void
  /** When set, renders a `+` corner button on prep-mode tiles. */
  onPrepBatch?: () => void
}) {
  // Display unit = the unit admin pinned as default in the item editor.
  // Falls back to the first configured unit if no flag is set (legacy
  // items pre-0020 migration). Both price + stock render in this unit
  // so the cashier sees one consistent number — matches the user's
  // stated preference: pick the unit per item, don't auto-derive.
  const displayUnit =
    product.units.find((u) => u.isDefault) ?? product.units[0]
  const stockInDisplay =
    displayUnit && displayUnit.ratioToBase > 0
      ? product.stockInBase / displayUnit.ratioToBase
      : product.stockInBase
  const hasMultipleUnits = product.units.length > 1

  // Tier-1 price in the DEFAULT display unit. If the default unit
  // has no tier-1 (admin only set bulk tiers), fall back to the
  // cheapest configured tier on that unit.
  const displayUnitTier =
    displayUnit?.tiers.find((t) => t.minQty === 1) ??
    [...(displayUnit?.tiers ?? [])].sort((a, b) => a.minQty - b.minQty)[0]
  const displayPrice = displayUnitTier?.unitPrice ?? 0
  const displayPriceUnit = displayUnit?.unitLabel ?? ''

  // Variant items price from their cheapest combo ("mulai Rp …") since
  // they carry no unit tiers; tapping opens the variant picker.
  const isVariant = Boolean(
    product.hasVariants && product.variants && product.variants.length > 0,
  )
  const variantPrices = isVariant
    ? product.variants!.map((v) => v.price).filter((p) => p > 0)
    : []
  const variantMinPrice =
    variantPrices.length > 0 ? Math.min(...variantPrices) : 0

  // JUR-15: prep-mode siap counter in the display unit. siapInBase is
  // null for non-prep items and 0+ for prep items. Tile hard-disables
  // when prep-mode AND siap = 0 (matches "Stok prep habis" sale-time
  // error so the cashier can't even attempt a sale that would fail).
  const isPrepMode = Boolean(product.prepMode)
  const siapInDisplay =
    isPrepMode && displayUnit && displayUnit.ratioToBase > 0
      ? (product.siapInBase ?? 0) / displayUnit.ratioToBase
      : 0
  const prepEmpty = isPrepMode && (product.siapInBase ?? 0) <= 0

  // Service-mode items don't carry own stock — they're always
  // sellable as long as ingredients exist (the BOM walker handles
  // the ingredient check at sale time, not here). For non-service
  // items, the existing stock gate stays. Prep-mode adds another gate.
  // Two different reasons an item carries no balance: made to order
  // (recipe-backed) or stocked by the supplier (consignment). Neither
  // can be judged "out of stock" from a balance nobody maintains.
  const untracked = product.recipeBacked || product.trackStock === false
  const outOfStock = !untracked && product.stockInBase <= 0
  const disabled = outOfStock || prepEmpty
  const lowStock =
    !untracked &&
    product.stockInBase > 0 &&
    displayUnit &&
    stockInDisplay <= 5

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-white text-left transition-colors dark:bg-gray-800',
        inCart
          ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-800'
          : 'border-gray-200 hover:border-brand-400 hover:bg-brand-50/30 dark:border-gray-700',
      )}
    >
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className={cn(
          'flex flex-col p-3 text-left',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <div className="relative mb-2 flex aspect-[2/1.5] w-full items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-brand-50 to-brand-100 text-2xl font-bold text-brand-600 dark:from-brand-900/30 dark:to-brand-900/10">
          {product.photoUrl ? (
            <img
              src={product.photoUrl}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-contain"
            />
          ) : (
            product.name.charAt(0).toUpperCase()
          )}
          {product.isFavorite && (
            <span
              title="Produk favorit — selalu di atas saat kategori Semua"
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-accent-100 text-accent-700 shadow-sm ring-1 ring-accent-200 dark:bg-accent-900/40 dark:text-accent-300 dark:ring-accent-700"
            >
              <Star className="h-3 w-3 fill-current" />
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          {product.name}
        </p>
        {isVariant ? (
          <p className="mt-1 text-sm font-semibold text-brand-700 dark:text-brand-300">
            mulai {formatRupiah(variantMinPrice)}
          </p>
        ) : (
          <p className="mt-1 text-sm font-semibold text-brand-700 dark:text-brand-300">
            {formatRupiah(displayPrice)}
            <span className="ml-0.5 text-xs font-normal text-gray-500">
              / {displayPriceUnit}
            </span>
          </p>
        )}
        <div className="mt-1.5 flex items-center justify-between">
          {isPrepMode ? (
            <span className="text-xs text-gray-500">
              Siap: {formatStock(siapInDisplay)} {displayUnit?.unitLabel ?? ''}
            </span>
          ) : product.recipeBacked ? (
            <span className="text-xs text-gray-500">Stok bahan</span>
          ) : product.trackStock === false ? (
            <span className="text-xs text-gray-500">Stok pemasok</span>
          ) : (
            <span className="text-xs text-gray-500">
              Stok: {formatStock(stockInDisplay)} {displayUnit?.unitLabel ?? ''}
            </span>
          )}
          {isPrepMode ? (
            prepEmpty ? (
              <Badge variant="danger">Habis prep</Badge>
            ) : (
              <Badge variant="success">Siap</Badge>
            )
          ) : product.recipeBacked ? (
            <Badge variant="default">Auto</Badge>
          ) : product.trackStock === false ? (
            <Badge variant="default">Titipan</Badge>
          ) : outOfStock ? (
            <Badge variant="danger">Habis</Badge>
          ) : lowStock ? (
            <Badge variant="warning">Sisa</Badge>
          ) : null}
        </div>
        {hasMultipleUnits && (
          <p className="mt-1 text-[10px] text-gray-400">
            {product.units.length} unit dijual
          </p>
        )}
      </button>

      {/*
        Corner `+` action — only on prep-mode tiles when caller passed
        onPrepBatch. Sits OUTSIDE the main button so its tap doesn't
        also fire onAdd. Always enabled even when Siap=0 (that's
        precisely when the cashier needs to refill).
      */}
      {isPrepMode && onPrepBatch && (
        <button
          type="button"
          onClick={onPrepBatch}
          aria-label={`Prep batch ${product.name}`}
          title="Prep batch"
          className={cn(
            'absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full',
            'bg-white/90 text-brand-600 shadow-sm ring-1 ring-brand-200 backdrop-blur',
            'hover:bg-brand-600 hover:text-white hover:ring-brand-600',
            'dark:bg-gray-800/90 dark:ring-brand-700',
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function formatStock(n: number): string {
  if (Number.isInteger(n)) return formatNumberID(n)
  // Show up to 2 decimals for fractional quantities so "0.75 kg" reads naturally.
  return formatNumberID(n, { maximumFractionDigits: 2 })
}
