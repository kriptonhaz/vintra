import { useState, useEffect, type ReactNode } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Search,
  Package,
  AlertTriangle,
  Star,
  PackagePlus,
} from 'lucide-react'
import {
  listInventoryItems,
  createInventoryItem,
  listInventoryFormMasters,
  uploadInventoryItemPhotoFn,
  copyHppPhotoToInventoryItemFn,
  getInventoryPhotoUrls,
  previewLinkedItemsForMaterial,
  applyHppPriceToInventory,
  setInventoryItemFavorite,
} from '@/server/functions/inventory'
import { getHppPhotoUrls } from '@/server/functions/hpp'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PhotoUploadField } from '@/components/inventory/photo-upload-field'
import { GalleryUploadField } from '@/components/inventory/gallery-upload-field'
import { ApplyHppBanner } from '@/components/inventory/apply-hpp-banner'
import { MarginPill } from '@/components/inventory/margin-pill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { inventoryMargin } from '@/lib/hpp-calculator'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { cn, formatNumberID } from '@/lib/utils' // JUR-137

export const Route = createFileRoute('/_authed/inventory/items/')({
  // Search params:
  //  ?view=sellable|ingredients — sidebar split. The same physical
  //    inventory_items table is presented two ways: "Katalog Produk"
  //    (sellable, what the cashier sees) and "Bahan Baku" (raw
  //    ingredients linked to HPP materials). Default = sellable for
  //    deeplinks that don't specify; renders both buckets only when
  //    the user navigates without filters.
  //  ?applyHpp=<materialId>   — deeplink from the HPP-cost-changed
  //    notification; renders an opt-in banner offering bulk
  //    apply-to-inventory.
  //  ?createFromHpp=<productId> — deeplink from HPP products page
  //    "Jual di POS". Opens the create sheet pre-filled with the
  //    product's name + linkedHppProductId so the cashier doesn't
  //    have to retype anything.
  validateSearch: (search: Record<string, unknown>): {
    applyHpp?: string
    createFromHpp?: string
    view?: 'sellable' | 'ingredients'
  } => {
    const out: {
      applyHpp?: string
      createFromHpp?: string
      view?: 'sellable' | 'ingredients'
    } = {}
    const a = search.applyHpp
    if (typeof a === 'string') out.applyHpp = a
    const c = search.createFromHpp
    if (typeof c === 'string') out.createFromHpp = c
    const v = search.view
    if (v === 'sellable' || v === 'ingredients') out.view = v
    return out
  },
  loaderDeps: ({ search }) => ({
    applyHpp: search.applyHpp,
    createFromHpp: search.createFromHpp,
    view: search.view,
  }),
  loader: async () => {
    // The item list (with per-branch stock) follows the topbar branch
    // switcher and is fetched client-side; the loader only preps the
    // branch-agnostic form masters.
    const masters = await listInventoryFormMasters()
    return { masters }
  },
  component: ItemsPage,
})

const itemFormSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  sku: z.string().max(50).optional(),
  brand: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  baseUnitId: z.string().uuid('Pilih unit'),
  // No `.default(0)` here — that makes the input type optional but
  // output required, which trips up RHF's Resolver typing. We supply
  // 0 via `defaultValues` on the form instead.
  costPrice: z.coerce.number().min(0),
  /**
   * Optional initial selling price. When set, the server seeds a tier-1
   * row on the base unit so the item is sellable in POS immediately.
   * Leave empty to skip — admin can configure per-unit + tier prices
   * later from the item detail page's "Unit & Harga" section.
   */
  initialSellingPrice: z.coerce.number().min(0).optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  linkedHppMaterialId: z.string().uuid().optional().or(z.literal('')),
  /** Recipe-backed HPP product. Mutually exclusive with material — the
   *  schema `product_materials_xor_chk` rejects both being set. JUR-10
   *  uses this link to walk the BOM on POS sales and auto-deduct
   *  ingredient stock. */
  linkedHppProductId: z.string().uuid().optional().or(z.literal('')),
  autoSyncHppCost: z.boolean().optional(),
  /**
   * "Tampilkan di POS" — when false, this item won't appear in the
   * cashier grid. Smart default at create time: false for ingredient-
   * inventory items (linked to an HPP material), true otherwise.
   */
  isSellable: z.boolean().optional(),
  /** JUR-183 booking fields. */
  isBookable: z.boolean().optional(),
  bookingColor: z.string().max(20).nullable().optional(),
  bookingDurationMin: z.coerce.number().int().min(1).max(720).nullable().optional(),
})
type ItemForm = z.infer<typeof itemFormSchema>

function ItemsPage() {
  const loader = Route.useLoaderData()
  const { applyHpp, createFromHpp, view } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { toast } = useToast()
  const { selectedBranchId } = useBranch()

  // Item list (with per-branch stock) follows the topbar branch switcher.
  const itemsQuery = useQuery({
    queryKey: ['inventory', 'items', selectedBranchId],
    queryFn: () =>
      listInventoryItems({
        data: {
          page: 1,
          pageSize: 500,
          lowStockOnly: false,
          branchId: selectedBranchId ?? undefined,
        },
      }),
  })
  const itemRows = itemsQuery.data?.items ?? []
  const itemTotal = itemsQuery.data?.total ?? 0

  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [bookableOnly, setBookableOnly] = useState(false)
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  // Inline favourite toggle. The loader holds the source-of-truth
  // `isFavorite`; this map records optimistic overrides so the star
  // flips instantly without waiting for a router invalidation. Rolled
  // back on a failed mutation.
  const [favoriteOverrides, setFavoriteOverrides] = useState<
    Record<string, boolean>
  >({})
  const [favoriteBusy, setFavoriteBusy] = useState<Record<string, boolean>>({})

  function isFavorite(it: { id: string; isFavorite: boolean }) {
    return favoriteOverrides[it.id] ?? it.isFavorite
  }

  async function handleToggleFavorite(it: { id: string; isFavorite: boolean }) {
    const next = !isFavorite(it)
    setFavoriteOverrides((prev) => ({ ...prev, [it.id]: next }))
    setFavoriteBusy((prev) => ({ ...prev, [it.id]: true }))
    try {
      await setInventoryItemFavorite({ data: { id: it.id, isFavorite: next } })
      // Cashier grid reads the same favourite flag — nudge it to refetch.
      queryClient.invalidateQueries({ queryKey: ['pos'] })
    } catch (err) {
      setFavoriteOverrides((prev) => ({ ...prev, [it.id]: !next }))
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal menyimpan',
        variant: 'error',
      })
    } finally {
      setFavoriteBusy((prev) => ({ ...prev, [it.id]: false }))
    }
  }

  // ?createFromHpp=<productId> deeplink (Case 1, "Jual di POS"). Auto-
  // open the create sheet on landing; the sheet pre-fills name +
  // linkedHppProductId from the matched product so the cashier just
  // picks the unit + saves. Drop the param after open so a refresh
  // doesn't loop.
  const prefillProduct = createFromHpp
    ? loader.masters.hppProducts.find((p) => p.id === createFromHpp) ?? null
    : null
  useEffect(() => {
    if (createFromHpp && prefillProduct) {
      setCreateOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFromHpp])

  // Batch-fetch signed URLs for every item that has a photoKey. Doing
  // this once on the page avoids N round-trips and keeps the list
  // render snappy. Cache on the keys so a navigate-back doesn't refetch.
  const photoKeys = itemRows
    .map((it) => it.photoKey)
    .filter((k): k is string => !!k)
  const { data: photoUrls } = useQuery({
    queryKey: ['inventory', 'photo-urls', photoKeys.sort().join('|')],
    queryFn: () => getInventoryPhotoUrls({ data: { keys: photoKeys } }),
    enabled: photoKeys.length > 0,
    staleTime: 4 * 60 * 1000, // signed URLs live 5 min, refetch a touch sooner
  })

  // Sidebar split: Katalog Produk = sellable, Bahan Baku = the
  // ingredient inventory items (`is_sellable=false`). When the user
  // arrives without a `view` param (e.g. via an internal deeplink)
  // we show every item — that's the legacy "Item" page behaviour.
  const filtered = itemRows.filter((it) => {
    if (view === 'sellable' && !it.isSellable) return false
    if (view === 'ingredients' && it.isSellable) return false
    if (lowStockOnly && !it.isLowStock) return false
    if (bookableOnly && !it.isBookable) return false
    if (favoriteOnly && !isFavorite(it)) return false
    if (categoryFilter && it.categoryId !== categoryFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return it.name.toLowerCase().includes(q) || it.sku?.toLowerCase().includes(q)
    }
    return true
  })

  // Page title + subtitle reflect the view filter so the header is
  // honest about what the cashier is looking at.
  const pageTitle =
    view === 'ingredients'
      ? 'Bahan Baku'
      : view === 'sellable'
        ? 'Katalog Produk'
        : t('inventory.itemsTitle')
  const pageSubtitle =
    view === 'ingredients'
      ? 'Bahan baku & ingredient — tidak muncul di kasir, dipakai untuk hitung HPP & resep.'
      : view === 'sellable'
        ? 'Item yang muncul di kasir POS untuk dijual.'
        : t('inventory.itemsSubtitle', { count: itemTotal })

  if (itemsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('common.loading')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {pageSubtitle}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link
            to="/inventory/items/import"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <PackagePlus className="h-4 w-4" /> Tambah Massal dari HPP
          </Link>
          <Button variant="brand" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> {t('inventory.addItem')}
          </Button>
        </div>
      </div>

      {/* HPP downlink banner — only visible when the page is opened
          via the "?applyHpp=<materialId>" deeplink from the
          inventory_hpp_cost_changed notification. Self-dismissing on
          apply or close. */}
      {applyHpp && (
        <ApplyHppBanner
          materialId={applyHpp}
          onDismiss={() =>
            router.navigate({
              to: '/inventory/items',
              search: {},
              replace: true,
            })
          }
          onApplied={async () => {
            await router.invalidate()
            queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] })
            router.navigate({
              to: '/inventory/items',
              search: {},
              replace: true,
            })
          }}
        />
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inventory.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
          />
          {t('inventory.lowStockOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={bookableOnly}
            onChange={(e) => setBookableOnly(e.target.checked)}
            className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
          />
          {t('inventory.bookableOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={favoriteOnly}
            onChange={(e) => setFavoriteOnly(e.target.checked)}
            className="h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
          />
          {t('inventory.favoriteOnly')}
        </label>
        <div className="sm:w-48">
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            options={[
              { value: '', label: t('inventory.allCategories') },
              ...loader.masters.categories.map((c) => ({
                value: c.id,
                label: c.name,
              })),
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <Package className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {t('inventory.itemsEmptyTitle')}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('inventory.itemsEmptyBody')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((it) => (
              <li key={it.id} className="flex items-center">
                <Link
                  to="/inventory/items/$itemId"
                  params={{ itemId: it.id }}
                  className="flex min-w-0 flex-1 items-center gap-3 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-700">
                    {it.photoKey && photoUrls?.[it.photoKey] ? (
                      <img
                        src={photoUrls[it.photoKey] as string}
                        alt={it.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Package className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {it.name}
                      </p>
                      {it.recipeBacked && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                          Resep
                        </span>
                      )}
                      {it.isBookable && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                          {t('inventory.bookableBadge')}
                        </span>
                      )}
                      {it.isLowStock && !it.recipeBacked && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
                          <AlertTriangle className="h-3 w-3" />
                          {t('inventory.lowStockBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {it.sku && <>{it.sku} · </>}
                      {it.brand && <>{it.brand} · </>}
                      {it.categoryName ?? t('inventory.noCategory')} ·{' '}
                      Modal {formatRupiah(it.costPrice)}/{it.baseUnit.label}
                      {' · '}
                      {it.lowestBaseUnitPrice != null ? (
                        <>
                          Jual mulai{' '}
                          {formatRupiah(it.lowestBaseUnitPrice)}/{it.baseUnit.label}
                          {it.pricingUnitCount > 1 && (
                            <span className="ml-1 text-gray-400">
                              ({it.pricingUnitCount} unit)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="font-medium text-warning-700 dark:text-warning-400">
                          Belum ada harga jual
                        </span>
                      )}
                      <MarginPill
                        margin={inventoryMargin(
                          it.costPrice,
                          it.lowestBaseUnitPrice,
                        )}
                      />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {it.recipeBacked ? (
                      <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
                        Auto
                        <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                          dari bahan
                        </span>
                      </p>
                    ) : (
                      <p
                        className={cn(
                          'font-semibold',
                          it.isLowStock
                            ? 'text-warning-700 dark:text-warning-400'
                            : 'text-gray-900 dark:text-gray-100',
                        )}
                      >
                        {formatNumberID(it.totalQuantity)} {it.baseUnit.label}
                      </p>
                    )}
                    {it.branchesCount > 1 && !it.recipeBacked && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {it.branchesCount} cabang
                      </p>
                    )}
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => handleToggleFavorite(it)}
                  disabled={favoriteBusy[it.id]}
                  aria-pressed={isFavorite(it)}
                  title={
                    isFavorite(it)
                      ? t('inventory.unmarkFavorite')
                      : t('inventory.markFavorite')
                  }
                  className="mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
                >
                  <Star
                    className={cn(
                      'h-5 w-5 transition-colors',
                      isFavorite(it)
                        ? 'fill-accent-400 text-accent-400'
                        : 'text-gray-300 dark:text-gray-600',
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)}>
        <SheetHeader onClose={() => setCreateOpen(false)}>
          <SheetTitle>{t('inventory.addItem')}</SheetTitle>
          <SheetDescription>{t('inventory.addItemDesc')}</SheetDescription>
        </SheetHeader>
        <CreateItemForm
          // Re-mount key on prefill so RHF picks up the new defaults
          // when the sheet opens with a different HPP product.
          key={prefillProduct?.id ?? 'manual'}
          masters={loader.masters}
          prefillFromHppProduct={prefillProduct}
          onCancel={() => {
            setCreateOpen(false)
            // Drop the deeplink param on cancel so a refresh doesn't
            // re-open the sheet. Preserve the `view` filter so the
            // user stays on Katalog Produk after dismissing.
            if (createFromHpp) {
              router.navigate({
                to: '/inventory/items',
                search: view ? { view } : {},
                replace: true,
              })
            }
          }}
          onSuccess={async () => {
            setCreateOpen(false)
            if (createFromHpp) {
              router.navigate({
                to: '/inventory/items',
                search: view ? { view } : {},
                replace: true,
              })
            }
            toast({
              title: t('common.toastSavedTitle'),
              description: t('inventory.itemCreatedToast'),
              variant: 'success',
            })
            await router.invalidate()
            queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] })
            // Cashier reads the same items + tier prices; nudge it
            // to refetch on next focus.
            queryClient.invalidateQueries({ queryKey: ['pos'] })
          }}
          onError={(msg) =>
            toast({
              title: t('common.toastFailedTitle'),
              description: msg,
              variant: 'error',
            })
          }
        />
      </Sheet>
    </div>
  )
}

function CreateItemForm({
  masters,
  prefillFromHppProduct,
  onCancel,
  onSuccess,
  onError,
}: {
  masters: Awaited<ReturnType<typeof listInventoryFormMasters>>
  /**
   * When set, pre-fills the form from an HPP product (Case 1 deeplink
   * "Jual di POS"): name copied, linkedHppProductId set, link source
   * defaulted to "product" so the recipe bridge is wired before the
   * user even sees the form.
   */
  prefillFromHppProduct?: {
    id: string
    name: string
    sku: string | null
  } | null
  onCancel: () => void
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const { t } = useTranslation()
  const form = useForm<ItemForm>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      name: prefillFromHppProduct?.name ?? '',
      sku: prefillFromHppProduct?.sku ?? '',
      brand: '',
      categoryId: '',
      baseUnitId: masters.units[0]?.id ?? '',
      costPrice: 0,
      initialSellingPrice: undefined,
      minStockLevel: undefined,
      linkedHppMaterialId: '',
      linkedHppProductId: prefillFromHppProduct?.id ?? '',
      autoSyncHppCost: true,
      // Smart default: hide ingredient items from POS, show
      // everything else. The form auto-flips below when the user
      // picks the HPP-material link. Recipe-backed prefill stays
      // sellable.
      isSellable: true,
      // JUR-183: opt-in for booking; tenant flips per-item.
      isBookable: false,
      bookingColor: null,
      bookingDurationMin: null,
    },
  })

  // Three-way selector for the HPP linkage. The DB enforces mutual
  // exclusion via product_materials_xor_chk; the radio just makes that
  // visible to the user and swaps the picker. We default to whichever
  // side already has a value when the form mounts (so editing stays
  // sticky); plain create starts at "none".
  const [linkSource, setLinkSource] = useState<'none' | 'material' | 'product'>(
    prefillFromHppProduct ? 'product' : 'none',
  )

  // Auto-flip "Tampilkan di POS" when the link source changes:
  // material → false (raw ingredient, hide), product/none → true.
  // User can override after; this only fires on radio change.
  useEffect(() => {
    form.setValue('isSellable', linkSource !== 'material')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkSource])

  // When the user picks an HPP material, auto-align the base unit so
  // stock-in cost-syncs land in the right column. Skipping this is the
  // single most common way to corrupt HPP cost (1000× off when units
  // differ). User can still override afterwards — we only nudge once
  // per pick.
  const linkedHppId = form.watch('linkedHppMaterialId')
  const linkedHppProductId = form.watch('linkedHppProductId')
  const baseUnitId = form.watch('baseUnitId')
  const selectedHppProduct = linkedHppProductId
    ? masters.hppProducts.find((p) => p.id === linkedHppProductId)
    : null

  // Auto-populate downstream fields from the picked Bahan baku — one
  // place handles all three (unit, cost, brand) so the rules stay
  // consistent. Each field only seeds when currently empty so a
  // user-typed value is never silently overwritten on re-render.
  useEffect(() => {
    if (!linkedHppId) return
    const mat = masters.hppMaterials.find((m) => m.id === linkedHppId)
    if (!mat) return
    // Unit: align base unit so HPP cost-syncs land in the right column.
    const matchingUnit = masters.units.find((u) => u.value === mat.unit)
    if (matchingUnit && matchingUnit.id !== form.getValues('baseUnitId')) {
      form.setValue('baseUnitId', matchingUnit.id, { shouldValidate: true })
    }
    // Cost: pricePerUnit from HPP material → no retyping of a value
    // that already lives on the material.
    const matPrice = Number(mat.pricePerUnit ?? 0)
    if (matPrice > 0 && !form.getValues('costPrice')) {
      form.setValue('costPrice', matPrice, { shouldValidate: true })
    }
    // Brand: same treatment. The previous BrandInput-internal effect
    // read control._formValues (unstable internal API) and missed
    // most of the time; doing it here uses the public getValues +
    // setValue API and reliably writes the value into the field
    // (the user can still edit afterwards).
    if (mat.brand && !form.getValues('brand')) {
      form.setValue('brand', mat.brand, { shouldValidate: true })
    }
    // Name: copy from material so the inventory item starts with
    // the same label the cashier knows from HPP. Skip when the
    // user already typed something — they might be tracking the
    // material under a different SKU name.
    if (mat.name && !form.getValues('name')) {
      form.setValue('name', mat.name, { shouldValidate: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedHppId])

  // Sister effect for the Produk-jadi side: when the user picks an
  // HPP product, mirror everything we know about it into the form so
  // they don't retype name / unit / category / prices. Each field
  // only seeds when currently empty so a user-typed value is never
  // overwritten on link-change.
  useEffect(() => {
    if (!linkedHppProductId) return
    const product = masters.hppProducts.find((p) => p.id === linkedHppProductId)
    if (!product) return
    if (product.name && !form.getValues('name')) {
      form.setValue('name', product.name, { shouldValidate: true })
    }
    // Unit Dasar — map HPP's text production unit (e.g. "Cup") to a
    // master_hpp_units row by .value. Soft-skip when no match so a
    // free-form label like "porsi" stays manual.
    if (product.productionUnit) {
      const matchingUnit = masters.units.find(
        (u) => u.value === product.productionUnit,
      )
      if (matchingUnit && matchingUnit.id !== form.getValues('baseUnitId')) {
        form.setValue('baseUnitId', matchingUnit.id, { shouldValidate: true })
      }
    }
    // Kategori — HPP stores category as free text; tenant_categories
    // is the FK table the form select uses. Match by name. Skip
    // silently when the HPP category doesn't exist as a tenant
    // category yet (user can still pick / create later).
    if (product.category && !form.getValues('categoryId')) {
      const matchingCategory = masters.categories.find(
        (c) => c.name === product.category,
      )
      if (matchingCategory) {
        form.setValue('categoryId', matchingCategory.id, {
          shouldValidate: true,
        })
      }
    }
    // Harga Jual Awal — HPP product's sellingPrice (already what the
    // owner thought when calculating margin). Cashier sees the same
    // number on the kasir grid.
    const sellPrice = Number(product.sellingPrice ?? 0)
    if (sellPrice > 0 && !form.getValues('initialSellingPrice')) {
      form.setValue('initialSellingPrice', sellPrice, {
        shouldValidate: true,
      })
    }
    // Harga Pokok — BOM-derived hpp. Saves the cashier from
    // recomputing modal cost manually; the HPP module already did
    // the math from ingredient prices × quantities.
    // `product.hpp` is a FULL BATCH cost; `costPrice` is per base unit. The
    // server ships `hppPerUnit` precomputed so this cannot be got wrong again.
    const hppCost = Number(product.hppPerUnit ?? 0)
    if (hppCost > 0 && !form.getValues('costPrice')) {
      form.setValue('costPrice', hppCost, { shouldValidate: true })
    }
    // Foto — show the HPP product's photo as a preview (signed URL via
    // <img>, which doesn't need bucket CORS). The actual S3 copy happens
    // server-side on save (copyHppPhotoToInventoryItemFn) so the new
    // inventory item gets its own key with an independent lifecycle. We
    // intentionally DON'T fetch the bytes into a data URL here — a
    // browser fetch of the presigned URL would require CORS and was
    // silently failing. Skip when the user already picked a photo.
    const photoKey = product.photoKey
    if (photoKey && !photoDataUrl && !inheritedPhotoUrl) {
      void (async () => {
        try {
          const urls = await getHppPhotoUrls({ data: { keys: [photoKey] } })
          const url = urls[photoKey]
          if (!url) return
          setInheritedPhotoUrl(url)
          setInheritedFromProductId(linkedHppProductId)
        } catch {
          // Soft-fail — photo prefill is a nice-to-have, never blocks the form.
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedHppProductId])

  const linkedMaterial = linkedHppId
    ? masters.hppMaterials.find((m) => m.id === linkedHppId)
    : null
  const selectedBaseUnit = masters.units.find((u) => u.id === baseUnitId)
  const unitMismatch =
    !!linkedMaterial &&
    !!selectedBaseUnit &&
    linkedMaterial.unit !== selectedBaseUnit.value

  // Photo upload is two-step on create: we need an item ID before we
  // can write to S3. The form holds a data URL until the createInventoryItem
  // server fn returns; then we fire uploadInventoryItemPhotoFn with the
  // new id. If the photo upload fails after the item is already saved,
  // we still close the sheet — the user can re-add the photo from the
  // detail page rather than losing their entire form input.
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  // "Jual di POS" photo inheritance: when the form is linked to an HPP
  // product, we preview that product's photo via its signed URL and
  // copy it server-side on save (no browser CORS). `inheritedPhotoUrl`
  // is the preview; `inheritedFromProductId` tells onSubmit to run the
  // copy. Both are cleared the moment the user picks their own photo.
  const [inheritedPhotoUrl, setInheritedPhotoUrl] = useState<string | null>(null)
  const [inheritedFromProductId, setInheritedFromProductId] = useState<
    string | null
  >(null)

  async function onSubmit(values: ItemForm) {
    try {
      const created = await createInventoryItem({
        data: {
          name: values.name,
          sku: values.sku || null,
          brand: values.brand || null,
          categoryId: values.categoryId || null,
          baseUnitId: values.baseUnitId,
          costPrice: values.costPrice,
          initialSellingPrice: values.initialSellingPrice ?? null,
          minStockLevel: values.minStockLevel ?? null,
          linkedHppMaterialId:
            linkSource === 'material'
              ? values.linkedHppMaterialId || null
              : null,
          autoSyncHppCost: values.autoSyncHppCost ?? true,
          linkedHppProductId:
            linkSource === 'product' ? values.linkedHppProductId || null : null,
          isSellable: values.isSellable ?? true,
          isBookable: values.isBookable ?? false,
          bookingColor: values.bookingColor ?? null,
          bookingDurationMin: values.bookingDurationMin ?? null,
        },
      })
      if (created?.id) {
        try {
          if (photoDataUrl) {
            // User picked/changed a photo → upload the data URL.
            await uploadInventoryItemPhotoFn({
              data: { itemId: created.id, photoDataUrl },
            })
          } else if (inheritedFromProductId) {
            // Inherited from the linked HPP product ("Jual di POS") and
            // left untouched → server-side S3 copy (no browser CORS).
            await copyHppPhotoToInventoryItemFn({
              data: {
                itemId: created.id,
                sourceProductId: inheritedFromProductId,
              },
            })
          }
        } catch (photoErr) {
          // Item is already saved — surface the photo error but don't
          // block. User can re-add it from the detail page.
          onError(
            photoErr instanceof Error
              ? `Item disimpan, tapi foto gagal: ${photoErr.message}`
              : 'Item disimpan, tapi foto gagal diunggah.',
          )
        }
      }
      onSuccess()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal menyimpan')
    }
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldPhoto')}
          </label>
          <PhotoUploadField
            value={photoDataUrl ?? inheritedPhotoUrl}
            onChange={(next) => {
              // Any manual change/removal takes over from the inherited
              // HPP photo, so drop the inheritance markers.
              setPhotoDataUrl(next)
              setInheritedPhotoUrl(null)
              setInheritedFromProductId(null)
            }}
            disabled={form.formState.isSubmitting}
            previewFit="contain"
          />
        </div>
        {/* Sumber HPP first — picking a link auto-fills Nama Item,
            Merk, Unit Dasar, and Harga Pokok before the user types
            anything. Bahan baku → name from material; Produk jadi →
            name from HPP product. */}
        {(masters.hppMaterials.length > 0 || masters.hppProducts.length > 0) && (
          <HppLinkPicker
            linkSource={linkSource}
            onLinkSourceChange={(next) => {
              setLinkSource(next)
              // Clear the side that's NOT active so submitted payload
              // doesn't carry a stale id from the other picker.
              if (next !== 'material')
                form.setValue('linkedHppMaterialId', '')
              if (next !== 'product') form.setValue('linkedHppProductId', '')
            }}
            materialControl={form.control}
            productControl={form.control}
            registerAutoSync={form.register('autoSyncHppCost')}
            hppMaterials={masters.hppMaterials}
            hppProducts={masters.hppProducts}
            linkedMaterial={linkedMaterial}
            selectedHppProduct={selectedHppProduct}
            unitMismatch={unitMismatch}
            showAutoSync={Boolean(linkedHppId)}
          />
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldName')} *
          </label>
          <Input
            {...form.register('name')}
            error={form.formState.errors.name?.message}
            placeholder={t('inventory.fieldNamePlaceholder')}
          />
        </div>

        <BrandInput
          register={form.register}
          linkedHppMaterial={linkedMaterial}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldSku')}
            </label>
            <Input {...form.register('sku')} placeholder="SKU-001" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldCategory')}
            </label>
            <Select
              {...form.register('categoryId')}
              options={[
                { value: '', label: t('inventory.noCategory') },
                ...masters.categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                })),
              ]}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldBaseUnit')} *
            </label>
            <Select
              {...form.register('baseUnitId')}
              options={masters.units.map((u) => ({
                value: u.id,
                label: u.label,
              }))}
              error={
                unitMismatch
                  ? t('inventory.unitMismatchInline', {
                      unit: linkedMaterial?.unit,
                    })
                  : form.formState.errors.baseUnitId?.message
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldCostPrice')}
              {selectedBaseUnit && (
                <span className="ml-1 text-xs font-normal text-gray-500">
                  (per {selectedBaseUnit.label})
                </span>
              )}
            </label>
            <Input
              type="number"
              min={0}
              // step="any" — Harga Pokok per base unit is often
              // fractional (Rp 0,316 per ml from a Rp 6.000 / 19L
              // gallon), and the HPP-material auto-fill writes those
              // values directly. step=1 forced integers and the
              // browser rejected the auto-filled value with "two
              // nearest valid values are 0 and 1".
              step="any"
              {...form.register('costPrice')}
            />
          </div>
        </div>
        {/*
          Service-mode (linkSource === 'product') items have no own
          stock balance, so a min-stock alert makes no sense — hide
          the field entirely. When hidden the price input takes the
          full row width. When both are shown, label uses min-h so
          the wrapped two-line "Harga Jual Awal (per Cup, opsional)"
          doesn't push its input down out of alignment with Stok
          Minimum's single-line label.
        */}
        <div
          className={cn(
            'grid gap-3',
            linkSource !== 'product' && 'sm:grid-cols-2',
          )}
        >
          <div>
            <label className="mb-1 flex min-h-[2.5rem] items-end text-sm font-medium text-gray-700 dark:text-gray-300">
              Harga Jual Awal
              {selectedBaseUnit && (
                <span className="ml-1 text-xs font-normal text-gray-500">
                  (per {selectedBaseUnit.label}, opsional)
                </span>
              )}
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              {...form.register('initialSellingPrice')}
              placeholder="Kosongkan = atur tier nanti"
            />
            {selectedBaseUnit && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Harga jual per 1 {selectedBaseUnit.label}. Cashier akan
                tampilkan ini saat menjual item.
              </p>
            )}
          </div>
          {linkSource !== 'product' && (
            <div>
              <label className="mb-1 flex min-h-[2.5rem] items-end text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('inventory.fieldMinStock')}
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                {...form.register('minStockLevel')}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t('inventory.fieldMinStockHint')}
              </p>
            </div>
          )}
        </div>

        <SellableToggle control={form.control} />
        <BookingFields control={form.control} />
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          variant="brand"
          loading={form.formState.isSubmitting}
          disabled={unitMismatch}
        >
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}

/**
 * Brand input. Auto-fill (when an HPP material is picked) is driven
 * by the parent's `useEffect` against `linkedHppId`, which writes
 * directly into the form via `setValue('brand', mat.brand)`. This
 * component is now a plain registered input — no internal effect, no
 * placeholder-as-hint dance.
 */
function BrandInput({
  register,
  linkedHppMaterial,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any
  linkedHppMaterial: { brand: string | null; name: string } | null | undefined
}) {
  const { t } = useTranslation()
  const hppBrand = linkedHppMaterial?.brand ?? null
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('inventory.fieldBrand')}
      </label>
      <Input
        {...register('brand')}
        placeholder={t('inventory.fieldBrandPlaceholder')}
      />
      {hppBrand && (
        <p className="mt-1 text-xs text-brand-700 dark:text-brand-300">
          {t('inventory.fieldBrandFromHppHint', { brand: hppBrand })}
        </p>
      )}
    </div>
  )
}

// CostPriceField (with the "Hitung dari kemasan" pack calculator)
// removed — the inline expand cluttered the row layout and most
// users got confused by the conversion math. Cost is now entered
// per-base-unit only. Auto-fill from a linked HPP material covers
// the most common case where the user knows the per-base price
// already (the material was set up with "1000 ml @ Rp 316" → the
// inventory item gets Rp 316 / ml prefilled). If a tenant later
// wants the pack calculator back, the previous implementation is
// in git history.

/**
 * "Tampilkan di POS" checkbox. Sits below the HPP link picker so the
 * smart default flow reads naturally:
 *
 *   pick "Bahan baku" link → toggle auto-flips to off (ingredient)
 *   pick "Produk jadi" / no link → toggle auto-flips to on
 *
 * The cashier can still hand-toggle for the bahan-baku-store edge
 * case where they DO sell raw materials.
 */
export function SellableToggle({
  control,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any
}) {
  return (
    <Controller
      name="isSellable"
      control={control}
      render={({ field }) => (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
          <input
            type="checkbox"
            checked={field.value ?? true}
            onChange={(e) => field.onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm">
            <span className="block font-medium text-gray-900 dark:text-gray-100">
              Tampilkan di POS Kasir
            </span>
            <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
              Matikan untuk item yang hanya kamu pakai sebagai bahan
              baku — tidak akan muncul di grid produk kasir.
            </span>
          </span>
        </label>
      )}
    />
  )
}

/**
 * JUR-183: booking fields — surfaces the item in /booking's service
 * picker when toggled on, with an optional color (calendar bubble) and
 * duration override (falls back to booking_settings.slot_duration_min
 * when null). Collapsed when the toggle is off so the form stays tidy.
 */
const BOOKING_COLOR_SWATCHES = [
  '#3d69e4', // blue
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#399d68', // green
  '#c9a24b', // amber
  '#c94840', // red
  '#06B6D4', // cyan
  '#677084', // grey
]

export function BookingFields({
  control,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any
}) {
  const isBookable = useWatch({ control, name: 'isBookable' }) as boolean | undefined
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <Controller
        name="isBookable"
        control={control}
        render={({ field }) => (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={field.value ?? false}
              onChange={(e) => field.onChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm">
              <span className="block font-medium text-gray-900 dark:text-gray-100">
                Bisa dipesan di booking
              </span>
              <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                Munculkan item ini di picker layanan saat membuat booking.
                Cocok untuk jasa salon/barber/klinik.
              </span>
            </span>
          </label>
        )}
      />

      {isBookable && (
        <div className="ml-7 space-y-3 border-l-2 border-gray-200 pl-4 dark:border-gray-700">
          <Controller
            name="bookingDurationMin"
            control={control}
            render={({ field }) => (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Durasi booking (menit)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    field.onChange(v === '' ? null : parseInt(v, 10))
                  }}
                  placeholder="Pakai default slot"
                  className="max-w-[200px]"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Kosongkan = pakai durasi slot default dari Pengaturan Booking.
                </p>
              </div>
            )}
          />

          <Controller
            name="bookingColor"
            control={control}
            render={({ field }) => (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Warna kalender
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => field.onChange(null)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs text-gray-500 ${
                      !field.value
                        ? 'border-brand-500'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                    aria-label="Tanpa warna"
                  >
                    ×
                  </button>
                  {BOOKING_COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => field.onChange(c)}
                      className={`h-7 w-7 rounded-full border-2 ${
                        field.value === c
                          ? 'border-gray-900 dark:border-gray-100'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Toko Online curation fields. "Jual online" surfaces the item in the
 * public storefront catalog; when on, the tenant can set an optional
 * shipping weight (manual ongkir reference) and an optional online
 * stock cap. Independent from `isSellable` (POS grid).
 */
export function OnlineFields({
  control,
  itemId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any
  /** When set (edit form), enables the storefront photo gallery. */
  itemId?: string
}) {
  const isOnline = useWatch({ control, name: 'isOnline' }) as boolean | undefined
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <Controller
        name="isOnline"
        control={control}
        render={({ field }) => (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={field.value ?? false}
              onChange={(e) => field.onChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm">
              <span className="block font-medium text-gray-900 dark:text-gray-100">
                Jual online
              </span>
              <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                Tampilkan item ini di toko online (situs) supaya bisa
                dibeli pengunjung lewat keranjang.
              </span>
            </span>
          </label>
        )}
      />

      {isOnline && (
        <div className="ml-7 grid gap-3 border-l-2 border-gray-200 pl-4 dark:border-gray-700 sm:grid-cols-2">
          <Controller
            name="shippingWeightGrams"
            control={control}
            render={({ field }) => (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Berat kirim (gram)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    field.onChange(v === '' ? null : parseInt(v, 10))
                  }}
                  placeholder="cth. 500"
                  className="tabular-nums"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Opsional, untuk referensi ongkir.
                </p>
              </div>
            )}
          />

          <Controller
            name="onlineStockCap"
            control={control}
            render={({ field }) => (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Batas stok online
                </label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    field.onChange(v === '' ? null : Number(v))
                  }}
                  placeholder="Pakai stok penuh"
                  className="tabular-nums"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Kosongkan = jual sebanyak stok tersedia.
                </p>
              </div>
            )}
          />

          {itemId && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Foto tambahan
              </label>
              <GalleryUploadField itemId={itemId} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Prep-mode toggle (JUR-15). Only shown when the item has a recipe
 * link (`linkSource === 'product'`). Flips the POS sale path between
 * "auto-deduct ingredients per sale" (off) and "manually run Prep
 * batch, then sales just decrement a counter" (on).
 *
 * `disabled` prop lets the caller hide it for unsupported items
 * (e.g., Free-tier tenants — the toggle still appears greyed-out so
 * the user knows the feature exists when they upgrade).
 */
export function PrepModeToggle({
  control,
  disabled,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any
  disabled?: boolean
}) {
  return (
    <Controller
      name="prepMode"
      control={control}
      render={({ field }) => (
        <label
          className={
            'flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40' +
            (disabled ? ' cursor-not-allowed opacity-60' : '')
          }
        >
          <input
            type="checkbox"
            checked={field.value ?? false}
            disabled={disabled}
            onChange={(e) => field.onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm">
            <span className="block font-medium text-gray-900 dark:text-gray-100">
              Mode prep batch
            </span>
            <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
              Cocok untuk item yang dibuat dalam batch besar (mis. 50
              cup teh per pagi). Saat aktif, bahan dikurangi sekali
              waktu &quot;Prep batch&quot;, lalu penjualan hanya
              mengurangi counter Siap.
            </span>
          </span>
        </label>
      )}
    />
  )
}

/**
 * HPP link picker. Three states:
 *   - 'none' → no HPP link
 *   - 'material' → standard "ingredient inventory" item that mirrors a
 *     raw material; cost-syncs from HPP and (optionally) writes back
 *   - 'product' → recipe-backed sellable item; on POS sale the BOM
 *     attached to the linked HPP product is walked to deduct each
 *     ingredient's stock (JUR-10)
 *
 * The DB enforces mutual exclusion via `product_materials_xor_chk`; the
 * radio just makes the choice obvious so the user doesn't accidentally
 * enter both.
 */
export function HppLinkPicker({
  linkSource,
  onLinkSourceChange,
  materialControl,
  productControl,
  registerAutoSync,
  hppMaterials,
  hppProducts,
  linkedMaterial,
  selectedHppProduct,
  unitMismatch,
  showAutoSync,
}: {
  linkSource: 'none' | 'material' | 'product'
  onLinkSourceChange: (next: 'none' | 'material' | 'product') => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  materialControl: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  productControl: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAutoSync: any
  hppMaterials: Array<{ id: string; name: string; unit: string; brand: string | null }>
  hppProducts: Array<{ id: string; name: string; sku: string | null; ingredientCount: number }>
  linkedMaterial: { name: string; unit: string; brand: string | null } | null | undefined
  selectedHppProduct:
    | { name: string; sku: string | null; ingredientCount: number }
    | null
    | undefined
  unitMismatch: boolean
  showAutoSync: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Sumber HPP
      </label>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        <SegmentBtn
          active={linkSource === 'none'}
          onClick={() => onLinkSourceChange('none')}
        >
          Tidak
        </SegmentBtn>
        <SegmentBtn
          active={linkSource === 'material'}
          onClick={() => onLinkSourceChange('material')}
          disabled={hppMaterials.length === 0}
        >
          Bahan baku
        </SegmentBtn>
        <SegmentBtn
          active={linkSource === 'product'}
          onClick={() => onLinkSourceChange('product')}
          disabled={hppProducts.length === 0}
        >
          Produk jadi
        </SegmentBtn>
      </div>

      {linkSource === 'material' && (
        <div className="mt-3">
          <Controller
            name="linkedHppMaterialId"
            control={materialControl}
            render={({ field }) => (
              <Combobox
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder={t('inventory.noHppLink')}
                emptyOptionLabel={t('inventory.noHppLink')}
                searchPlaceholder={t('inventory.searchHppMaterialPlaceholder')}
                emptyResultLabel={t('inventory.searchNoResults')}
                options={hppMaterials.map((m) => ({
                  value: m.id,
                  label: `${m.name} (${m.unit})`,
                }))}
              />
            )}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('inventory.fieldLinkHppMaterialHint')}
          </p>
          {linkedMaterial && !unitMismatch && (
            <p className="mt-1 rounded-md bg-brand-50 px-2 py-1.5 text-xs text-brand-700 dark:bg-brand-900/20 dark:text-brand-300">
              {t('inventory.unitMatchOk', { unit: linkedMaterial.unit })}
            </p>
          )}
          {showAutoSync && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
              <input
                type="checkbox"
                {...registerAutoSync}
                className="mt-0.5 h-4 w-4 rounded text-brand-600 focus:ring-brand-500"
              />
              <span className="text-xs">
                <span className="block font-medium text-gray-700 dark:text-gray-300">
                  {t('inventory.autoSyncHppLabel')}
                </span>
                <span className="mt-0.5 block text-gray-500 dark:text-gray-400">
                  {t('inventory.autoSyncHppHint')}
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      {linkSource === 'product' && (
        <div className="mt-3">
          <Controller
            name="linkedHppProductId"
            control={productControl}
            render={({ field }) => (
              <Combobox
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="Pilih produk HPP…"
                emptyOptionLabel="Tidak terhubung"
                searchPlaceholder="Cari nama produk…"
                emptyResultLabel={t('inventory.searchNoResults')}
                options={hppProducts.map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.ingredientCount > 0 ? ` · ${p.ingredientCount} bahan` : ''}`,
                }))}
              />
            )}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Hubungkan ke produk HPP yang punya resep. Saat item ini terjual
            di POS, stok bahan baku akan otomatis berkurang sesuai resep.
          </p>
          {selectedHppProduct && selectedHppProduct.ingredientCount === 0 && (
            <p className="mt-1 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-200">
              Produk ini belum punya resep — auto-deduct tidak akan jalan
              sampai kamu tambahkan bahan di menu HPP.
            </p>
          )}
          {selectedHppProduct && selectedHppProduct.ingredientCount > 0 && (
            <p className="mt-1 rounded-md bg-brand-50 px-2 py-1.5 text-xs text-brand-700 dark:bg-brand-900/20 dark:text-brand-300">
              Resep terhubung: {selectedHppProduct.ingredientCount} bahan akan
              auto-deduct setiap penjualan (paket Toko/Komplit).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SegmentBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? 'rounded-md bg-white py-1.5 text-xs font-semibold text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
          : disabled
            ? 'rounded-md py-1.5 text-xs font-medium text-gray-300 dark:text-gray-600'
            : 'rounded-md py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'
      }
    >
      {children}
    </button>
  )
}
