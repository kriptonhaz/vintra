import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MarginBadge } from '@/components/modules/hpp/margin-badge'
import { formatRupiah, formatRupiahDecimal } from '@/lib/currency'
import { formatDate } from '@/lib/utils'
import { getProductForEdit, duplicateProduct } from '@/server/functions/hpp'
import {
  Pencil,
  Trash2,
  Package,
  Calendar,
  Tag,
  FileText,
  X,
  Loader2,
  ShoppingBag,
  Copy,
} from 'lucide-react'

interface ProductDetailDialogProps {
  productId: string | null
  onClose: () => void
  onDelete: (id: string) => void
  /** Called after a successful duplicate so the parent can refresh
   *  the list (and optionally navigate). The new product id is
   *  passed back so the caller can deeplink into the calculator. */
  onDuplicated?: (newProductId: string) => void
}

type ProductDetail = Awaited<ReturnType<typeof getProductForEdit>>

export function ProductDetailDialog({
  productId,
  onClose,
  onDelete,
  onDuplicated,
}: ProductDetailDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  async function handleDuplicate() {
    if (!product) return
    setDuplicating(true)
    try {
      const cloned = await duplicateProduct({ data: { id: product.id } })
      onClose()
      onDuplicated?.(cloned.id)
      // Land in the calculator pre-filled with the clone so the user
      // can start editing immediately — matches the stated UX goal
      // ("after duplicate user can easily just update the new item").
      navigate({
        to: '/hpp/calculate',
        search: { editProductId: cloned.id },
      })
    } catch (err) {
      console.error('Failed to duplicate product:', err)
    } finally {
      setDuplicating(false)
    }
  }

  useEffect(() => {
    if (!productId) {
      setData(null)
      return
    }
    setLoading(true)
    getProductForEdit({ data: { productId } })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [productId])

  const product = data?.product
  const materials = data?.materials ?? []
  const totalHpp = product?.hpp ?? 0
  const profit = product ? product.sellingPrice - totalHpp : 0

  return (
    <Dialog open={!!productId} onClose={onClose} className="max-w-2xl">
      {/* Header — sticky with close button */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('hppDetail.title')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : product ? (
        <>
          <DialogContent className="space-y-5">
            {/* ── Product Info Section ── */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('hppDetail.productInfo')}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <InfoItem
                  icon={Package}
                  label={t('hppDetail.productName')}
                  value={product.name}
                />
                <InfoItem
                  icon={Tag}
                  label={t('hppDetail.category')}
                  value={product.category || '-'}
                />
                {product.sku && (
                  <InfoItem
                    icon={Tag}
                    label={t('hppDetail.sku')}
                    value={product.sku}
                  />
                )}
                {product.productionQty && (
                  <InfoItem
                    icon={Package}
                    label={t('hppDetail.productionOutput')}
                    value={`${Number(product.productionQty)} ${product.productionUnit || 'porsi'}`}
                  />
                )}
                <InfoItem
                  icon={Calendar}
                  label={t('hppDetail.lastUpdated')}
                  value={formatDate(product.updatedAt)}
                />
                {product.notes && (
                  <InfoItem
                    icon={FileText}
                    label={t('hppDetail.notes')}
                    value={product.notes}
                    fullWidth
                  />
                )}
              </div>
            </section>

            {/* ── Financial Summary Section ── */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('hppDetail.financialSummary')}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <FinancialCard
                  label={t('hppDetail.totalHpp')}
                  value={totalHpp ? formatRupiah(totalHpp) : '-'}
                />
                <FinancialCard
                  label={t('hppDetail.sellingPrice')}
                  value={formatRupiah(product.sellingPrice)}
                />
                <FinancialCard
                  label={t('hppDetail.profit')}
                  value={totalHpp ? formatRupiah(profit) : '-'}
                  valueColor={profit > 0 ? 'text-success-600 dark:text-success-400' : profit < 0 ? 'text-red-600 dark:text-red-400' : undefined}
                />
                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('hppDetail.margin')}</p>
                  <div className="mt-1">
                    <MarginBadge margin={product.margin} />
                  </div>
                </div>
              </div>
            </section>

            {/* ── Cost Breakdown Section ── */}
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('hppDetail.costBreakdown')} ({materials.length})
              </h3>

              {materials.length > 0 ? (
                <>
                  {/* Resolve per-row display once. BOM rows are XOR
                      material-sourced vs sub-product-sourced; the latter
                      have null material fields and instead carry the
                      source product's name + per-unit HPP that we derive
                      from sourceHpp / sourceProductionQty (mirrors the
                      math the calculator uses when first adding the
                      sub-recipe row). */}
                  {/* Desktop table */}
                  <div className="hidden overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 sm:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('hppDetail.colItem')}
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('hppDetail.colSupplier')}
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('hppDetail.colQty')}
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('hppDetail.colPrice')}
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('hppDetail.colSubtotal')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {materials.map((item) => {
                          const view = resolveBomRowView(item)
                          const qty = Number(item.quantity)
                          const subtotal = qty * view.price
                          return (
                            <tr
                              key={item.id}
                              className="border-b border-gray-100 last:border-b-0 dark:border-gray-700/50"
                            >
                              <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                                {view.name}
                                {view.brand && (
                                  <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                                    ({view.brand})
                                  </span>
                                )}
                                {view.isSubProduct && (
                                  <span className="ml-1.5 inline-flex rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                                    Sub-resep
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                {view.supplier || '-'}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                                {qty} {item.unit}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                                {formatRupiahDecimal(view.price)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">
                                {formatRupiahDecimal(subtotal)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                          <td
                            colSpan={4}
                            className="px-3 py-2 text-right text-xs font-semibold uppercase text-gray-600 dark:text-gray-300"
                          >
                            {t('hppDetail.totalHpp')}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-gray-100">
                            {formatRupiah(totalHpp)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="space-y-2 sm:hidden">
                    {materials.map((item) => {
                      const view = resolveBomRowView(item)
                      const qty = Number(item.quantity)
                      const subtotal = qty * view.price
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {view.name}
                                {view.isSubProduct && (
                                  <span className="ml-1.5 inline-flex rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                                    Sub-resep
                                  </span>
                                )}
                              </p>
                              {view.brand && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                  {view.brand}
                                </p>
                              )}
                              {view.supplier && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {view.supplier}
                                </p>
                              )}
                            </div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              {formatRupiahDecimal(subtotal)}
                            </p>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>
                              {qty} {item.unit}
                            </span>
                            <span>&times;</span>
                            <span>{formatRupiahDecimal(view.price)}</span>
                          </div>
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/50">
                      <span className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-300">
                        {t('hppDetail.totalHpp')}
                      </span>
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {formatRupiah(totalHpp)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('hppDetail.noCostItems')}
                </p>
              )}
            </section>
          </DialogContent>

          {/* Footer with actions — Hapus left, then "Jual di POS"
              (bridges this product to a sellable inventory item),
              then primary Edit. The recipe is already visible above
              in the Cost Breakdown section, so a separate "Lihat
              Resep" affordance isn't needed. */}
          {/* Mobile: 2x2 grid (Hapus | Duplikat / Jual di POS | Edit) so
              all 4 buttons stay tappable without truncation. The primary
              "Edit" lands in the bottom-right where the right thumb
              naturally falls; the destructive "Hapus" sits top-left to
              minimise mis-tap risk. Desktop reverts to a single right-
              aligned row. */}
          <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-700 sm:flex sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <Button
              variant="danger"
              className="w-full sm:w-auto"
              onClick={() => {
                onClose()
                onDelete(product.id)
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={handleDuplicate}
              loading={duplicating}
            >
              <Copy className="h-4 w-4" />
              Duplikat
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                // Land on Katalog Produk (?view=sellable) so the
                // sidebar tree highlights the right child + the page
                // title reads "Katalog Produk" instead of the legacy
                // bare "Item" view.
                navigate({
                  to: '/inventory/items',
                  search: { createFromHpp: product.id, view: 'sellable' },
                })
              }}
            >
              <ShoppingBag className="h-4 w-4" />
              Jual di POS
            </Button>
            <Button
              variant="brand"
              className="w-full sm:w-auto"
              onClick={() => {
                navigate({
                  to: '/hpp/calculate',
                  search: { editProductId: product.id },
                })
              }}
            >
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </Button>
          </div>
        </>
      ) : null}
    </Dialog>
  )
}

// ─── Helper subcomponents ──────────────────────────────

function InfoItem({
  icon: Icon,
  label,
  value,
  fullWidth,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  fullWidth?: boolean
}) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  )
}

function FinancialCard({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-sm font-bold ${valueColor ?? 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </p>
    </div>
  )
}

/** Collapse a BOM row (which is XOR material-sourced or sub-product-
 *  sourced) into a single display shape so the table + mobile cards
 *  don't have to fork their JSX. Sub-product rows derive their
 *  per-unit price the same way productOptions does in the calculator
 *  (totalHpp / productionQty) — keeps the displayed subtotal aligned
 *  with what the calculator used when the row was added. */
function resolveBomRowView(item: ProductDetail['materials'][number]): {
  name: string
  brand: string | null
  supplier: string | null
  price: number
  isSubProduct: boolean
} {
  if (item.sourceProductId) {
    const totalHpp = Number(item.sourceHpp ?? 0)
    const rawQty = Number(item.sourceProductionQty ?? 1)
    const prodQty = rawQty > 0 ? rawQty : 1
    const perUnit = prodQty > 0 ? totalHpp / prodQty : totalHpp
    return {
      name: item.sourceName ?? '—',
      brand: null,
      supplier: null,
      price: perUnit,
      isSubProduct: true,
    }
  }
  return {
    name: item.materialName ?? '—',
    brand: item.materialBrand ?? null,
    supplier: item.supplierName ?? null,
    price: Number(item.pricePerUnit ?? 0),
    isSubProduct: false,
  }
}
