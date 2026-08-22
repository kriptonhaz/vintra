import { useState, useEffect } from 'react'
import { createFileRoute, Link, useRouter, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Package, Building2, Pencil, Trash2, Plus, X, ShoppingCart, AlertCircle, Sparkles, ChefHat, Star } from 'lucide-react'
import {
  getInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
  deleteInventoryItem,
  listInventoryFormMasters,
  addItemUnit,
  removeItemUnit,
  upsertPricingTier,
  removePricingTier,
  setDefaultUnit,
  setInventoryItemFavorite,
  uploadInventoryItemPhotoFn,
  removeInventoryItemPhoto,
} from '@/server/functions/inventory'
import type {
  RecipeIngredientView,
  RecipeSubRecipe,
} from '@/server/functions/inventory'
import { PhotoUploadField } from '@/components/inventory/photo-upload-field'
import { VariantManager } from '@/components/inventory/variant-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { inventoryMargin } from '@/lib/hpp-calculator'
import { MarginPill } from '@/components/inventory/margin-pill'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { cn, formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import { HppLinkPicker, SellableToggle, PrepModeToggle, BookingFields, OnlineFields } from './items.index'
import { getPrepStatus } from '@/server/functions/pos-prep'
import { PrepBatchSheet } from '@/components/pos/prep-batch-sheet'

export const Route = createFileRoute('/_authed/inventory/items/$itemId')({
  loader: async ({ params }) => {
    const [item, masters] = await Promise.all([
      getInventoryItem({ data: { id: params.itemId } }),
      listInventoryFormMasters(),
    ])
    return { item, masters }
  },
  component: ItemDetailPage,
})

const editItemSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  sku: z.string().max(50).optional(),
  brand: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  baseUnitId: z.string().uuid('Pilih unit'),
  costPrice: z.coerce.number().min(0),
  franchisePrice: z.coerce.number().min(0).optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  linkedHppMaterialId: z.string().uuid().optional().or(z.literal('')),
  /** JUR-10: link to a recipe-backed HPP product so POS sales of this
   *  item walk the BOM and auto-deduct ingredient stock. */
  linkedHppProductId: z.string().uuid().optional().or(z.literal('')),
  autoSyncHppCost: z.boolean().optional(),
  /** "Tampilkan di POS" — Case 2 toggle. */
  isSellable: z.boolean().optional(),
  /** JUR-183 booking fields. */
  isBookable: z.boolean().optional(),
  bookingColor: z.string().max(20).nullable().optional(),
  bookingDurationMin: z.coerce.number().int().min(1).max(720).nullable().optional(),
  /** JUR-15: prep-batch mode for recipe-backed items. */
  prepMode: z.boolean().optional(),
  /** Pin to top of POS "Semua" view. */
  isFavorite: z.boolean().optional(),
  /** Toko Online curation. */
  isOnline: z.boolean().optional(),
  shippingWeightGrams: z.coerce.number().int().min(0).nullable().optional(),
  onlineStockCap: z.coerce.number().min(0).nullable().optional(),
})
type EditItemForm = z.infer<typeof editItemSchema>

function ItemDetailPage() {
  const { item, masters } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { toast } = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [destroyOpen, setDestroyOpen] = useState(false)
  const [destroying, setDestroying] = useState(false)

  /**
   * Inventory edits cascade into POS — pricing tiers, unit setup, and
   * stock balances all feed the cashier grid. Invalidate the POS query
   * cache after every mutation so the cashier reflects the change on
   * its next render (no manual hard-refresh required).
   */
  function invalidatePOS() {
    queryClient.invalidateQueries({ queryKey: ['pos'] })
  }

  // Hard delete only when there's nothing to lose. Once any movement
  // or stock balance exists, fall back to deactivate so the audit
  // trail survives.
  const hasHistory =
    item.recentMovements.length > 0 || item.perBranch.length > 0
  const baseUnit = masters.units.find((u) => u.id === item.baseUnitId)

  // Cheapest configured tier-1 price across all units, normalised back
  // to per-base-unit so the header summary stays comparable across
  // items. Null when no tier exists at all (item not yet sellable).
  const lowestBaseUnitPrice = (() => {
    let lowest: number | null = null
    for (const u of item.units) {
      const tier1 = u.tiers.find((t) => t.minQty === 1)
      if (!tier1) continue
      const perBase = tier1.unitPrice / u.ratioToBase
      if (lowest == null || perBase < lowest) lowest = perBase
    }
    return lowest
  })()
  const hasAnyPricing = item.units.some((u) => u.tiers.length > 0)

  async function handleDestroy() {
    setDestroying(true)
    try {
      if (hasHistory) {
        await deactivateInventoryItem({ data: { id: item.id } })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('inventory.itemDeactivatedToast'),
          variant: 'success',
        })
      } else {
        await deleteInventoryItem({ data: { id: item.id } })
        toast({
          title: t('common.toastSavedTitle'),
          description: t('inventory.itemDeletedToast'),
          variant: 'success',
        })
      }
      navigate({ to: '/inventory/items' })
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal',
        variant: 'error',
      })
      setDestroying(false)
      setDestroyOpen(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <Link
        to="/inventory/items"
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('inventory.backToItems')}
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-700">
            {item.photoUrl ? (
              <img
                src={item.photoUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {item.name}
            </h1>
            {/* Effective brand: own column wins; otherwise the linked
                HPP material's brand fills in. The pill marks an HPP
                fallback so the user knows where the value came from. */}
            {(item.brand || item.linkedHppBrand) && (
              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                <span className="font-medium">
                  {item.brand ?? item.linkedHppBrand}
                </span>
                {!item.brand && item.linkedHppBrand && (
                  <span className="ml-1.5 inline-flex rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    {t('inventory.brandFromHppBadge')}
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {item.sku && <>{item.sku} · </>}
              <span title="Harga modal (cost / HPP)">
                Modal {formatRupiah(Number(item.costPrice))}
                {baseUnit && <> / {baseUnit.label}</>}
              </span>
              {' · '}
              {lowestBaseUnitPrice != null ? (
                <span
                  className="font-medium text-gray-700 dark:text-gray-300"
                  title="Harga jual termurah (per unit dasar)"
                >
                  Jual mulai {formatRupiah(lowestBaseUnitPrice)}
                  {baseUnit && <> / {baseUnit.label}</>}
                </span>
              ) : (
                <span className="font-medium text-warning-700 dark:text-warning-400">
                  Belum ada harga jual
                </span>
              )}
              {item.minStockLevel != null && (
                <> · {t('inventory.detailMinLabel')} {formatNumberID(item.minStockLevel)}{baseUnit && ` ${baseUnit.label}`}</>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="gap-1"
            >
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDestroyOpen(true)}
              className="gap-1 text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-900/20"
            >
              <Trash2 className="h-4 w-4" />
              {hasHistory ? t('inventory.deactivate') : t('common.delete')}
            </Button>
          </div>
        </div>
      </div>

      {/* "Produk Favorit" — pin this item to the top of the POS
          cashier grid when the "Semua" (all-categories) chip is
          active. Owners surface best-sellers / staples so cashiers
          don't have to scroll. The toggle here is a one-tap action
          (not buried inside the edit sheet) so flipping it during a
          rush stays fast. */}
      <FavoriteSection
        itemId={item.id}
        initialIsFavorite={item.isFavorite ?? false}
        onChange={() => {
          router.invalidate()
          invalidatePOS()
        }}
        onError={(msg) =>
          toast({
            title: t('common.toastFailedTitle'),
            description: msg,
            variant: 'error',
          })
        }
      />

      {/* Selling-price prompt. Items without ANY pricing tier won't
          appear in the POS cashier grid. Surface the gap so users
          coming from POS ("why isn't sugar in my cashier?") have a
          one-click path to fix it. */}
      {!hasAnyPricing && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-warning-200 bg-warning-50 p-4 dark:border-warning-800 dark:bg-warning-900/20">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-400" />
          <div className="flex-1">
            <p className="font-medium text-warning-900 dark:text-warning-200">
              Belum ada harga jual
            </p>
            <p className="mt-0.5 text-sm text-warning-800 dark:text-warning-300">
              Item ini tidak akan muncul di kasir (POS) sampai harga jual
              di salah satu unit dikonfigurasi. Tambah tier harga di
              bagian "Unit & Harga" di bawah.
            </p>
          </div>
        </div>
      )}

      {/* Alt units (Toko+) — gives the user a way to record movements
          in pcs / dus etc. without losing the per-base-unit cost math. */}
      {item.tier !== 'free' && (
        <UnitConversionsSection
          item={item}
          masters={masters}
          onChange={() => {
            router.invalidate()
            invalidatePOS()
          }}
          onError={(msg) =>
            toast({
              title: t('common.toastFailedTitle'),
              description: msg,
              variant: 'error',
            })
          }
        />
      )}

      {/* Recipe ingredients (JUR-10). Visible only when this item is
          recipe-backed (has linkedHppProductId) and the recipe has at
          least one material. Owners use this to verify what's
          auto-deducted when they sell — and to see at a glance which
          materials are linked to inventory vs unlinked. */}
      {item.recipeIngredients &&
        (item.recipeIngredients.length > 0 ||
          item.subRecipes.length > 0) && (
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-800 dark:bg-brand-900/10">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" />
              <h2 className="text-sm font-semibold text-brand-900 dark:text-brand-200">
                Stok-out otomatis saat penjualan
              </h2>
            </div>
            <p className="mb-3 text-xs text-brand-800 dark:text-brand-300">
              Setiap kali item ini terjual, bahan-bahan berikut otomatis
              dikurangi stoknya (paket Toko ke atas).
            </p>
            {item.recipeIngredients.length > 0 && (
              <ul className="space-y-1.5">
                {item.recipeIngredients.map((r) => (
                  <RecipeIngredientRow key={r.materialId} ing={r} />
                ))}
              </ul>
            )}
            {item.subRecipes.length > 0 && (
              <div className="mt-2 space-y-2">
                {item.subRecipes.map((sub) => (
                  <SubRecipeBlock key={sub.productId} sub={sub} />
                ))}
              </div>
            )}
          </div>
        )}

      {/*
        JUR-15: prep-batch panel. Renders only for prep-mode items
        (linkedHppProductId set AND prep_mode=true). Shows current
        Siap counter per branch + a "Prep batch" CTA. Without this
        panel, prep-mode items would be unreachable from the
        inventory page (the cashier corner-`+` button is the other
        way in, but operators expect to manage items from here too).
      */}
      {item.prepMode && item.linkedHppProductId && (
        <PrepBatchPanel item={item} branches={masters.branches} />
      )}

      <VariantManager itemId={item.id} />

      {/*
        Service-mode (linkedHppProductId set) items have no own stock
        balance — the BOM walker deducts ingredients on each sale,
        the parent item never carries quantity. Showing "Stok per
        Cabang: belum ada stok" + "Pergerakan: belum ada" would
        falsely suggest the user needs to add stock; the recipe panel
        above already explains the model. Hide both sections when
        the item is recipe-backed.
      */}
      {!item.linkedHppProductId && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('inventory.detailStockPerBranch')}
          </h2>
          {item.perBranch.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('inventory.detailNoStockYet')}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {item.perBranch.map((b) => (
                <li
                  key={b.branchId}
                  className="flex items-center gap-3 py-2"
                >
                  <Building2 className="h-4 w-4 text-gray-400" />
                  <p className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                    {b.branchName}
                  </p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">
                    {formatNumberID(b.quantity)}
                    {baseUnit && <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">{baseUnit.label}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Recent movements — same service-mode guard. */}
      {!item.linkedHppProductId && (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('inventory.detailRecentMovements')}
        </h2>
        {item.recentMovements.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('inventory.detailNoMovementsYet')}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {item.recentMovements.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold',
                    m.type === 'in'
                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                      : m.type === 'out'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
                  )}
                >
                  {m.type === 'in' ? '+' : m.type === 'out' ? '−' : '±'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-gray-900 dark:text-gray-100">
                    {m.type === 'in' ? '+' : m.type === 'out' ? '−' : '±'}
                    {formatNumberID(m.quantity)} · {m.branchName}
                    {m.reason && <> · {m.reason}</>}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(m.createdAt, 'dd MMM yyyy, HH:mm')}
                    {m.unitCost != null && (
                      <> · @{formatRupiah(m.unitCost)}</>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      <Sheet open={editOpen} onClose={() => setEditOpen(false)}>
        <SheetHeader onClose={() => setEditOpen(false)}>
          <SheetTitle>{t('inventory.editItem')}</SheetTitle>
          <SheetDescription>{t('inventory.editItemDesc')}</SheetDescription>
        </SheetHeader>
        <EditItemForm
          item={item}
          masters={masters}
          onCancel={() => setEditOpen(false)}
          onSuccess={async () => {
            setEditOpen(false)
            toast({
              title: t('common.toastSavedTitle'),
              description: t('inventory.itemUpdatedToast'),
              variant: 'success',
            })
            await router.invalidate()
            invalidatePOS()
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

      <ConfirmDialog
        open={destroyOpen}
        onCancel={() => setDestroyOpen(false)}
        onConfirm={handleDestroy}
        title={
          hasHistory
            ? t('inventory.deactivateConfirmTitle')
            : t('inventory.deleteConfirmTitle')
        }
        description={
          hasHistory
            ? t('inventory.deactivateConfirmDesc', { name: item.name })
            : t('inventory.deleteConfirmDesc', { name: item.name })
        }
        confirmText={
          hasHistory ? t('inventory.deactivate') : t('common.delete')
        }
        cancelText={t('common.cancel')}
        variant="danger"
        loading={destroying}
      />
    </div>
  )
}

/** One BOM material row in the "Stok-out otomatis" panel. Shared by
 *  the top-level list and every nested sub-recipe. */
function RecipeIngredientRow({ ing }: { ing: RecipeIngredientView }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 dark:bg-gray-800">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {ing.materialName}
        </p>
        {ing.ingredientItemId ? (
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            Stok: {ing.ingredientItemName}
          </p>
        ) : (
          <p className="text-xs text-warning-700 dark:text-warning-400">
            ⚠ Belum terhubung ke inventaris — stok tidak auto-deduct
          </p>
        )}
      </div>
      <span className="shrink-0 text-sm font-semibold text-brand-700 dark:text-brand-300">
        {formatNumberID(ing.quantity)} {ing.unit}
      </span>
    </li>
  )
}

/** A sub-recipe (product-in-product) with its own ingredients, nested
 *  recursively. Shows an amber note when the sub-recipe can't be
 *  auto-deducted (no production qty / unit mismatch / cycle). */
function SubRecipeBlock({ sub }: { sub: RecipeSubRecipe }) {
  return (
    <div className="rounded-md border border-brand-200 bg-white/60 p-3 dark:border-brand-800 dark:bg-gray-800/40">
      <div className="mb-2 flex items-center gap-2">
        <ChefHat className="h-4 w-4 shrink-0 text-brand-600" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-900 dark:text-brand-200">
          Sub-resep: {sub.productName}
        </p>
        <span className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-300">
          {formatNumberID(sub.quantity)} {sub.unit}
        </span>
      </div>
      {!sub.scalable && (
        <p className="mb-2 rounded-md bg-warning-50 px-2 py-1.5 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
          ⚠ Atur jumlah produksi sub-resep ini di menu HPP agar bahannya
          ikut dikurangi otomatis saat penjualan.
        </p>
      )}
      {sub.ingredients.length > 0 && (
        <ul className="space-y-1.5">
          {sub.ingredients.map((ing) => (
            <RecipeIngredientRow key={ing.materialId} ing={ing} />
          ))}
        </ul>
      )}
      {sub.subRecipes.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-brand-200 pl-3 dark:border-brand-800">
          {sub.subRecipes.map((child) => (
            <SubRecipeBlock key={child.productId} sub={child} />
          ))}
        </div>
      )}
    </div>
  )
}

function EditItemForm({
  item,
  masters,
  onCancel,
  onSuccess,
  onError,
}: {
  item: Awaited<ReturnType<typeof getInventoryItem>>
  masters: Awaited<ReturnType<typeof listInventoryFormMasters>>
  onCancel: () => void
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const { t } = useTranslation()
  const form = useForm<EditItemForm>({
    resolver: zodResolver(editItemSchema),
    defaultValues: {
      name: item.name,
      sku: item.sku ?? '',
      brand: item.brand ?? '',
      categoryId: item.categoryId ?? '',
      baseUnitId: item.baseUnitId,
      costPrice: Number(item.costPrice),
      franchisePrice: item.franchisePrice ?? undefined,
      minStockLevel: item.minStockLevel ?? undefined,
      linkedHppMaterialId: item.linkedHppMaterialId ?? '',
      linkedHppProductId: item.linkedHppProductId ?? '',
      autoSyncHppCost: item.autoSyncHppCost ?? true,
      isSellable: item.isSellable ?? true,
      isBookable: item.isBookable ?? false,
      bookingColor: item.bookingColor ?? null,
      bookingDurationMin: item.bookingDurationMin ?? null,
      prepMode: item.prepMode ?? false,
      isFavorite: item.isFavorite ?? false,
      isOnline: item.isOnline ?? false,
      shippingWeightGrams: item.shippingWeightGrams ?? null,
      onlineStockCap: item.onlineStockCap ? Number(item.onlineStockCap) : null,
    },
  })

  // Initialize the radio from whatever side already has a value so
  // editing an existing recipe-backed item starts on the right tab.
  const [linkSource, setLinkSource] = useState<'none' | 'material' | 'product'>(
    item.linkedHppProductId
      ? 'product'
      : item.linkedHppMaterialId
        ? 'material'
        : 'none',
  )

  const linkedHppId = form.watch('linkedHppMaterialId')
  const linkedHppProductId = form.watch('linkedHppProductId')
  const baseUnitId = form.watch('baseUnitId')
  const selectedHppProduct = linkedHppProductId
    ? masters.hppProducts.find((p) => p.id === linkedHppProductId)
    : null

  useEffect(() => {
    if (!linkedHppId) return
    const mat = masters.hppMaterials.find((m) => m.id === linkedHppId)
    if (!mat) return
    const matchingUnit = masters.units.find((u) => u.value === mat.unit)
    if (matchingUnit && matchingUnit.id !== form.getValues('baseUnitId')) {
      form.setValue('baseUnitId', matchingUnit.id, { shouldValidate: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedHppId])

  const linkedMaterial = linkedHppId
    ? masters.hppMaterials.find((m) => m.id === linkedHppId)
    : null
  const selectedBaseUnit = masters.units.find((u) => u.id === baseUnitId)
  const unitMismatch =
    !!linkedMaterial &&
    !!selectedBaseUnit &&
    linkedMaterial.unit !== selectedBaseUnit.value

  // Photo state machine for the edit form:
  //   - photoValue holds whatever the widget currently shows: the
  //     original signed S3 URL on first load, a fresh data URL after
  //     re-upload, or null after the user clicks remove.
  //   - photoChanged tracks whether the user touched it. We only fire
  //     the upload/remove server fns when this is true — saving the
  //     form without touching the photo shouldn't re-upload anything.
  const [photoValue, setPhotoValue] = useState<string | null>(item.photoUrl)
  const [photoChanged, setPhotoChanged] = useState(false)

  function handlePhotoChange(next: string | null) {
    setPhotoValue(next)
    setPhotoChanged(true)
  }

  async function onSubmit(values: EditItemForm) {
    try {
      await updateInventoryItem({
        data: {
          id: item.id,
          name: values.name,
          sku: values.sku || null,
          brand: values.brand || null,
          categoryId: values.categoryId || null,
          baseUnitId: values.baseUnitId,
          costPrice: values.costPrice,
          franchisePrice: values.franchisePrice ? values.franchisePrice : null,
          minStockLevel: values.minStockLevel ?? null,
          linkedHppMaterialId:
            linkSource === 'material'
              ? values.linkedHppMaterialId || null
              : null,
          autoSyncHppCost: values.autoSyncHppCost ?? true,
          linkedHppProductId:
            linkSource === 'product'
              ? values.linkedHppProductId || null
              : null,
          isSellable: values.isSellable ?? true,
          isBookable: values.isBookable ?? false,
          bookingColor: values.bookingColor ?? null,
          bookingDurationMin: values.bookingDurationMin ?? null,
          // prep_mode is only meaningful when the recipe link is on.
          // Force false when toggling away from 'product' so a stale
          // form value doesn't hit the DB CHECK constraint.
          prepMode:
            linkSource === 'product' ? values.prepMode ?? false : false,
          isFavorite: values.isFavorite ?? false,
          isOnline: values.isOnline ?? false,
          shippingWeightGrams: values.shippingWeightGrams ?? null,
          onlineStockCap: values.onlineStockCap ?? null,
        },
      })
      // Only re-fire S3 work when the photo actually changed. New
      // data URL → upload; explicit null → remove. Untouched (still
      // showing the original signed S3 URL) → skip.
      if (photoChanged) {
        try {
          if (photoValue && photoValue.startsWith('data:')) {
            await uploadInventoryItemPhotoFn({
              data: { itemId: item.id, photoDataUrl: photoValue },
            })
          } else if (photoValue == null) {
            await removeInventoryItemPhoto({ data: { itemId: item.id } })
          }
        } catch (photoErr) {
          // Item metadata already saved; surface the photo error but
          // don't block the close — the form state is consistent.
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
            value={photoValue}
            onChange={handlePhotoChange}
            disabled={form.formState.isSubmitting}
            previewFit="contain"
          />
        </div>
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
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('inventory.fieldBrand')}
          </label>
          <Input
            {...form.register('brand')}
            placeholder={
              linkedMaterial?.brand
                ? t('inventory.fieldBrandPlaceholderFromHpp', {
                    brand: linkedMaterial.brand,
                  })
                : t('inventory.fieldBrandPlaceholder')
            }
          />
          {linkedMaterial?.brand && (
            <p className="mt-1 text-xs text-brand-700 dark:text-brand-300">
              {t('inventory.fieldBrandFromHppHint', {
                brand: linkedMaterial.brand,
              })}
            </p>
          )}
        </div>
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
              // step="any" so fractional per-base-unit prices
              // (Rp 0,316 / ml from a gallon purchase) pass HTML5
              // validation. step=1 forced integers + rejected the
              // value the form was loaded with.
              step="any"
              {...form.register('costPrice')}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('inventory.fieldFranchisePrice')}
            </label>
            <Input
              type="number"
              min={0}
              step="any"
              placeholder={t('inventory.fieldFranchisePricePlaceholder')}
              {...form.register('franchisePrice')}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('inventory.fieldFranchisePriceHint')}
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/40 p-3 text-xs text-brand-900 dark:border-brand-900/40 dark:bg-brand-900/10 dark:text-brand-200">
            <p className="font-medium">Harga jual diatur terpisah</p>
            <p className="mt-0.5 text-brand-800 dark:text-brand-300">
              Per-unit + tier (harga grosir) ada di bagian
              "Unit & Harga" di halaman detail item.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
        </div>
        {(masters.hppMaterials.length > 0 || masters.hppProducts.length > 0) && (
          <HppLinkPicker
            linkSource={linkSource}
            onLinkSourceChange={(next) => {
              setLinkSource(next)
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

        <SellableToggle control={form.control} />
        <BookingFields control={form.control} />
        <OnlineFields control={form.control} itemId={item.id} />
        {linkSource === 'product' && (
          <PrepModeToggle control={form.control} />
        )}
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
 * "Produk Favorit" toggle section. Single-field affordance — the only
 * reason this is its own server fn (setInventoryItemFavorite) instead
 * of routing through the full edit form is so flipping the flag
 * mid-shift is one click, no sheet, no scroll. Local state mirrors
 * the server so the UI flips instantly; we roll back if the mutation
 * rejects.
 */
function FavoriteSection({
  itemId,
  initialIsFavorite,
  onChange,
  onError,
}: {
  itemId: string
  initialIsFavorite: boolean
  onChange: () => void
  onError: (msg: string) => void
}) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite)
  const [busy, setBusy] = useState(false)

  async function handleToggle() {
    const next = !isFavorite
    setIsFavorite(next)
    setBusy(true)
    try {
      await setInventoryItemFavorite({ data: { id: itemId, isFavorite: next } })
      onChange()
    } catch (err) {
      setIsFavorite(!next)
      onError(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 transition-colors',
        isFavorite
          ? 'border-accent-200 bg-accent-50 dark:border-accent-800 dark:bg-accent-900/20'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
      )}
    >
      <div
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-full',
          isFavorite
            ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
        )}
      >
        <Star className={cn('h-5 w-5', isFavorite && 'fill-current')} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'font-medium',
            isFavorite
              ? 'text-accent-900 dark:text-accent-200'
              : 'text-gray-900 dark:text-gray-100',
          )}
        >
          Produk Favorit
        </p>
        <p
          className={cn(
            'mt-0.5 text-xs',
            isFavorite
              ? 'text-accent-800 dark:text-accent-300'
              : 'text-gray-600 dark:text-gray-400',
          )}
        >
          {isFavorite
            ? 'Item ini muncul di paling atas grid kasir saat filter "Semua" aktif.'
            : 'Aktifkan untuk menampilkan item ini di paling atas grid kasir saat filter "Semua" aktif. Cocok untuk produk best-seller atau menu andalan.'}
        </p>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        role="switch"
        aria-checked={isFavorite}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          isFavorite ? 'bg-accent-500' : 'bg-gray-300 dark:bg-gray-600',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            isFavorite ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

/**
 * JUR-15: prep-batch panel on the item detail page. Owner picks a
 * branch, sees the current Siap counter, and opens the shared
 * PrepBatchSheet to record a new prep.
 *
 * Keeps the panel small — the Sheet itself shows the recent-prep tail
 * + handles the mutation. This panel's only job is branch selection +
 * a live Siap readout so the operator knows whether to refill.
 */
function PrepBatchPanel({
  item,
  branches,
}: {
  item: Awaited<ReturnType<typeof getInventoryItem>>
  branches: Array<{ id: string; name: string }>
}) {
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? '')
  const [sheetOpen, setSheetOpen] = useState(false)

  // Default unit drives both the display ratio and what 1 prep means.
  // For prep-mode items the cashier tile uses the same unit, so we
  // stay consistent: a prep of "1" here means one item from the tile.
  const defaultUnit =
    item.units.find((u) => u.isDefault) ?? item.units[0]
  const ratioToBase = defaultUnit ? Number(defaultUnit.ratioToBase) : 1

  const status = useQuery({
    queryKey: ['prep-status', item.id, branchId],
    queryFn: () =>
      getPrepStatus({ data: { itemId: item.id, branchId } }),
    enabled: Boolean(branchId),
    staleTime: 30 * 1000,
  })

  const siapBase = status.data?.siapInBase ?? 0
  const siapDisplay = ratioToBase > 0 ? siapBase / ratioToBase : siapBase
  const isEmpty = siapBase <= 0

  if (branches.length === 0) return null

  return (
    <>
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-800 dark:bg-brand-900/10">
        <div className="mb-3 flex items-center gap-2">
          <ChefHat className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-brand-900 dark:text-brand-200">
            Mode prep batch aktif
          </h2>
        </div>
        <p className="mb-4 text-xs text-brand-800 dark:text-brand-300">
          Setiap kali kamu masak/siapkan batch baru, klik &quot;Prep
          batch&quot; agar bahan resep otomatis dikurangi dari
          inventaris dan counter Siap bertambah. Saat penjualan,
          counter Siap berkurang otomatis (bukan bahan resep).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {branches.length > 1 && (
            <div className="flex-1 min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Cabang
              </label>
              <Select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
          )}
          <div className="flex-1 min-w-[140px]">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Siap dijual
            </p>
            <p
              className={cn(
                'text-2xl font-bold',
                isEmpty
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-brand-700 dark:text-brand-300',
              )}
            >
              {status.isLoading
                ? '…'
                : `${formatNumberID(siapDisplay, { maximumFractionDigits: 2 })} ${defaultUnit?.unitLabel ?? ''}`}
            </p>
          </div>
          <Button
            type="button"
            variant="brand"
            onClick={() => setSheetOpen(true)}
            disabled={!branchId}
          >
            <ChefHat className="mr-1.5 h-4 w-4" /> Prep batch
          </Button>
        </div>
        {isEmpty && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-900/20 dark:text-red-200">
            Stok prep habis — kasir tidak bisa menjual item ini sampai
            kamu melakukan prep batch baru.
          </p>
        )}
      </div>
      {defaultUnit && branchId && (
        <PrepBatchSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          item={{ id: item.id, name: item.name }}
          branchId={branchId}
          unit={{
            id: defaultUnit.unitId,
            label: defaultUnit.unitLabel,
            ratioToBase: ratioToBase,
          }}
        />
      )}
    </>
  )
}

/**
 * Unit + Pricing editor — replaces the old multi-unit conversion
 * section with a unified per-unit + per-tier pricing editor. Each
 * configured unit (base + alt) gets its own card with a tier ladder.
 *
 * Margin guard rails (computed from `item.costPrice`):
 *   - tier price < per-unit cost → soft yellow warning ("akan rugi")
 *   - tier price < cost × 0.5    → blocking confirm ("yakin?
 *     selisih > 50%, biasanya typo")
 *
 * Cost is stored per BASE unit, so the per-unit cost for an alt unit
 * row is `costPrice × ratioToBase` (1 kg costs 1000 × Rp 14 = Rp 14k).
 */
function UnitConversionsSection({
  item,
  masters,
  onChange,
  onError,
}: {
  item: Awaited<ReturnType<typeof getInventoryItem>>
  masters: Awaited<ReturnType<typeof listInventoryFormMasters>>
  onChange: () => void
  onError: (msg: string) => void
}) {
  const { t } = useTranslation()
  const [addingUnit, setAddingUnit] = useState(false)
  const [newUnitId, setNewUnitId] = useState('')
  const [newRatio, setNewRatio] = useState('')
  const [busy, setBusy] = useState(false)

  const usedUnitIds = new Set(item.units.map((u) => u.unitId))
  const availableUnits = masters.units.filter((u) => !usedUnitIds.has(u.id))
  const baseUnit = masters.units.find((u) => u.id === item.baseUnitId)
  const baseCostPerBaseUnit = Number(item.costPrice)

  async function handleAddUnit() {
    if (!newUnitId || !newRatio) return
    const ratioNum = Number(newRatio)
    if (!Number.isFinite(ratioNum) || ratioNum <= 0) {
      onError('Rasio harus lebih dari 0')
      return
    }
    setBusy(true)
    try {
      await addItemUnit({
        data: { itemId: item.id, unitId: newUnitId, ratioToBase: ratioNum },
      })
      setAddingUnit(false)
      setNewUnitId('')
      setNewRatio('')
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveUnit(id: string) {
    setBusy(true)
    try {
      await removeItemUnit({ data: { id } })
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Unit &amp; Harga
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Kelola unit yang bisa dijual (base = {baseUnit?.label ?? '—'}) dan
            atur harga jual per tier (harga grosir auto-apply saat qty ≥ tier).
          </p>
        </div>
        {!addingUnit && availableUnits.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setAddingUnit(true)}
            className="shrink-0 gap-1"
          >
            <Plus className="h-4 w-4" />
            Tambah Unit
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {item.units.map((u) => (
          <UnitCard
            key={u.id}
            unit={u}
            baseUnitLabel={baseUnit?.label ?? ''}
            costPerBaseUnit={baseCostPerBaseUnit}
            itemId={item.id}
            linkedHppProductId={item.linkedHppProductId ?? null}
            busy={busy}
            setBusy={setBusy}
            onChange={onChange}
            onError={onError}
            onRemoveUnit={handleRemoveUnit}
          />
        ))}
      </div>

      {addingUnit && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600 sm:grid sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-gray-500 sm:hidden">
              Unit baru
            </label>
            <Select
              value={newUnitId}
              onChange={(e) => setNewUnitId(e.target.value)}
              options={[
                { value: '', label: 'Pilih unit…' },
                ...availableUnits.map((u) => ({ value: u.id, label: u.label })),
              ]}
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-gray-500 sm:hidden">
              Rasio (1 unit baru = ? {baseUnit?.label ?? 'base'})
            </label>
            <Input
              type="number"
              min={0}
              step={0.0001}
              value={newRatio}
              onChange={(e) => setNewRatio(e.target.value)}
              placeholder={`1 unit = ? ${baseUnit?.label ?? 'base'}`}
            />
          </div>
          <div className="flex gap-2 sm:flex-col">
            <Button
              variant="ghost"
              onClick={() => setAddingUnit(false)}
              disabled={busy}
              className="flex-1 sm:flex-none"
            >
              Batal
            </Button>
            <Button
              variant="brand"
              onClick={handleAddUnit}
              loading={busy}
              className="flex-1 sm:flex-none"
            >
              Simpan
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

interface UnitCardProps {
  unit: Awaited<ReturnType<typeof getInventoryItem>>['units'][number]
  baseUnitLabel: string
  costPerBaseUnit: number
  itemId: string
  /**
   * Set when this item's price is owned by an HPP recipe. The price controls
   * are replaced by a link to where the price actually lives — hiding them
   * without saying where to go would just look broken.
   */
  linkedHppProductId: string | null
  busy: boolean
  setBusy: (b: boolean) => void
  onChange: () => void
  onError: (msg: string) => void
  onRemoveUnit: (id: string) => void
}

function UnitCard({
  unit,
  baseUnitLabel,
  costPerBaseUnit,
  itemId,
  linkedHppProductId,
  busy,
  setBusy,
  onChange,
  onError,
  onRemoveUnit,
}: UnitCardProps) {
  const [draftMinQty, setDraftMinQty] = useState('')
  const [draftPrice, setDraftPrice] = useState('')

  // Cost in this unit's terms (Rp per 1 of this unit).
  const costPerUnit = costPerBaseUnit * unit.ratioToBase

  async function handleAddTier() {
    const minQty = Number(draftMinQty)
    const price = Number(draftPrice)
    if (!Number.isFinite(minQty) || minQty <= 0) {
      onError('Min qty harus lebih dari 0')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      onError('Harga tidak valid')
      return
    }
    // Blocking margin check: refuse if price < 50% of cost without
    // explicit confirm (likely a typo).
    if (costPerUnit > 0 && price < costPerUnit * 0.5) {
      const ok = window.confirm(
        `Harga Rp ${formatNumberID(price)} jauh lebih rendah dari modal Rp ${formatNumberID(Math.round(costPerUnit))} (selisih > 50%). Yakin ini bukan typo?`,
      )
      if (!ok) return
    }
    setBusy(true)
    try {
      await upsertPricingTier({
        data: { itemId, unitId: unit.unitId, minQty, unitPrice: price },
      })
      setDraftMinQty('')
      setDraftPrice('')
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveTier(id: string) {
    setBusy(true)
    try {
      await removePricingTier({ data: { id } })
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal')
    } finally {
      setBusy(false)
    }
  }

  async function handleSetDefault() {
    setBusy(true)
    try {
      await setDefaultUnit({
        data: { itemId, unitId: unit.unitId },
      })
      onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/40 p-3 dark:border-gray-700 dark:bg-gray-900/20">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {unit.unitLabel}
            {unit.isBase && (
              <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
                Unit Dasar
              </span>
            )}
            {unit.isDefault && (
              <span className="ml-2 rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
                Default Tampilan
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {unit.isBase ? (
              <>1 {unit.unitLabel} (rasio dasar)</>
            ) : (
              <>1 {unit.unitLabel} = {unit.ratioToBase} {baseUnitLabel}</>
            )}{' '}
            · Modal {formatRupiah(Math.round(costPerUnit))} / {unit.unitLabel}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!unit.isDefault && (
            <button
              type="button"
              onClick={handleSetDefault}
              disabled={busy}
              className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              title="Tampilkan harga + stok di unit ini saat di kasir"
            >
              Jadikan Default
            </button>
          )}
          {!unit.isBase && (
            <button
              type="button"
              onClick={() => onRemoveUnit(unit.id)}
              disabled={busy}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-danger-600 dark:hover:bg-gray-700"
              aria-label="Hapus unit"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Existing tiers */}
      {unit.tiers.length > 0 ? (
        <ul className="space-y-1.5">
          {unit.tiers.map((t) => {
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded border border-gray-100 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  ≥ {t.minQty} {unit.unitLabel}
                </span>
                <span className="text-gray-400">→</span>
                <span className="flex-1 font-semibold text-gray-900 dark:text-gray-100">
                  {formatRupiah(t.unitPrice)} / {unit.unitLabel}
                </span>
                {/* Margin of THIS tier. `costPerUnit` is already scaled to
                    the tier's unit above, so a bulk-pack tier is judged
                    against the cost of a bulk pack, not of one piece. */}
                <MarginPill
                  className="ml-0"
                  margin={inventoryMargin(costPerUnit, t.unitPrice)}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveTier(t.id)}
                  disabled={busy}
                  aria-label="Hapus tier"
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-danger-600 dark:hover:bg-gray-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-gray-500">
          Belum ada tier harga. Tambah minimal 1 (mis. min qty 1) supaya
          unit ini bisa dijual di kasir.
        </p>
      )}

      {/* Price is owned by the recipe. Point at where it lives rather than
          just disabling the inputs — a dead form with no explanation reads as
          a bug. Deep-links to step 3, where the selling price actually is,
          instead of dropping the owner on the HPP list to find the product
          again. */}
      {linkedHppProductId ? (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800/50">
          <p className="text-gray-700 dark:text-gray-300">
            Harga item ini <span className="font-medium">mengikuti produk HPP-nya</span>.
          </p>
          <Link
            to="/hpp/calculate"
            search={{ editProductId: linkedHppProductId, step: 3 }}
            className="mt-1 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Ubah harga jual di HPP →
          </Link>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Tier grosir dan unit lain tetap diatur di sini.
          </p>
        </div>
      ) : (
      <div className="mt-2 flex flex-col gap-2 sm:grid sm:grid-cols-[100px_1fr_auto] sm:gap-1.5">
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-gray-500 sm:hidden">
            Min qty
          </label>
          <Input
            type="number"
            min={0.0001}
            step={0.0001}
            value={draftMinQty}
            onChange={(e) => setDraftMinQty(e.target.value)}
            placeholder={`mis. 1${unit.tiers.length > 0 ? ` atau ${Math.max(...unit.tiers.map((t) => t.minQty)) * 10}` : ''}`}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-gray-500 sm:hidden">
            Harga per {unit.unitLabel}
          </label>
          <Input
            type="number"
            min={0}
            step={1}
            value={draftPrice}
            onChange={(e) => setDraftPrice(e.target.value)}
            placeholder={`Harga / ${unit.unitLabel}`}
          />
        </div>
        <Button
          variant="outline"
          onClick={handleAddTier}
          disabled={busy || !draftMinQty || !draftPrice}
          className="w-full gap-1 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Tambah Tier
        </Button>
      </div>
      )}
      {(() => {
        const draft = Number(draftPrice)
        if (!Number.isFinite(draft) || draft <= 0 || costPerUnit <= 0) return null
        if (draft < costPerUnit) {
          return (
            <p className="mt-1 text-xs text-warning-700 dark:text-warning-400">
              ⚠ Harga ini lebih rendah dari modal Rp {formatNumberID(Math.round(costPerUnit))} / {unit.unitLabel} — akan rugi Rp {formatNumberID(Math.round(costPerUnit - draft))} per unit.
            </p>
          )
        }
        return null
      })()}
    </div>
  )
}
