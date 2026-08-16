import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getHppReport, deleteProduct, getHppPhotoUrls } from '@/server/functions/hpp'
import { invalidateTenantProducts } from '@/lib/invalidate'
import { formatRupiah } from '@/lib/currency'
import { perUnitHpp } from '@/lib/hpp-calculator'
import { formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MarginBadge } from '@/components/modules/hpp/margin-badge'
import { ProductDetailDialog } from '@/components/modules/hpp/product-detail-dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  Package,
  TrendingUp,
  Star,
  AlertTriangle,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

export const Route = createFileRoute('/_authed/hpp/')({
  loader: () => getHppReport(),
  component: HppIndexPage,
})

// ─── Constants ──────────────────────────────────────

const PAGE_SIZE = 10

// Sentinel for the "products with no category" filter option.
const UNCATEGORIZED = '__uncategorized__'

// ─── Main Page ───────────────────────────────────────

function HppIndexPage() {
  const { t } = useTranslation()
  const report = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()

  // ── Search, pagination, delete state ───────────────

  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [mutationLoading, setMutationLoading] = useState(false)

  // ── Derived stats ──────────────────────────────────

  const totalProducts = report.products.length

  const productsWithMargin = report.products.filter((p) => p.margin !== null)
  const avgMargin =
    productsWithMargin.length > 0
      ? productsWithMargin.reduce((sum, p) => sum + (p.margin ?? 0), 0) /
        productsWithMargin.length
      : null

  const now = Date.now()
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000
  const recentCount = report.products.filter(
    (p) => now - new Date(p.createdAt).getTime() < oneWeekMs,
  ).length

  const bestProduct = productsWithMargin.length > 0
    ? productsWithMargin.reduce((best, p) =>
        (p.margin ?? 0) > (best.margin ?? 0) ? p : best,
      )
    : null

  const needsUpdateCount = report.products.filter(
    (p) => p.hpp === null,
  ).length

  // ── Category filter options ────────────────────────

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of report.products) {
      if (p.category && p.category.trim()) set.add(p.category)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [report.products])

  const hasUncategorized = useMemo(
    () => report.products.some((p) => !p.category || !p.category.trim()),
    [report.products],
  )

  // ── Filtered + paginated products ──────────────────

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return report.products.filter((p) => {
      if (query && !p.name.toLowerCase().includes(query)) return false
      if (categoryFilter === UNCATEGORIZED) {
        if (p.category && p.category.trim()) return false
      } else if (categoryFilter && p.category !== categoryFilter) {
        return false
      }
      return true
    })
  }, [report.products, searchQuery, categoryFilter])

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)

  const paginatedProducts = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filteredProducts.slice(start, start + PAGE_SIZE)
  }, [filteredProducts, safePage])

  // ── Photo URLs for the visible page ────────────────
  // Batch every visible row's effectivePhotoKey (own or fallback from
  // a linked inventory item) into one server call so we don't fan out
  // N requests from the client. 5-minute TTL is plenty for a list view.
  const visiblePhotoKeys = useMemo(
    () =>
      paginatedProducts
        .map((p) => p.effectivePhotoKey)
        .filter((k): k is string => !!k),
    [paginatedProducts],
  )
  const photoUrlsQuery = useQuery({
    queryKey: ['hpp', 'photo-urls', visiblePhotoKeys.sort().join(',')],
    queryFn: () => getHppPhotoUrls({ data: { keys: visiblePhotoKeys } }),
    enabled: visiblePhotoKeys.length > 0,
    staleTime: 4 * 60 * 1000, // a bit shorter than the URL's 5-min TTL
  })
  const photoUrls = photoUrlsQuery.data ?? {}

  // ── Handlers ───────────────────────────────────────

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value)
    setCurrentPage(1)
  }

  function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCategoryFilter(e.target.value)
    setCurrentPage(1)
  }

  async function handleDeleteProduct() {
    if (!deletingId) return
    setMutationLoading(true)
    try {
      await deleteProduct({ data: { id: deletingId } })
      invalidateTenantProducts(queryClient)
      router.invalidate()
      setDeletingId(null)
    } catch (e) {
      console.error('Failed to delete product:', e)
    } finally {
      setMutationLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('hpp.totalProducts')}
          value={String(totalProducts)}
          subtitle={recentCount > 0 ? t('hpp.thisWeek', { count: recentCount }) : t('hpp.noNewProducts')}
          subtitleColor={recentCount > 0 ? 'green' : 'gray'}
          icon={Package}
          iconBg="bg-brand-100"
          iconColor="text-brand-600"
        />
        <StatCard
          label={t('hpp.avgMargin')}
          value={avgMargin !== null ? `${avgMargin.toFixed(1)}%` : '-'}
          subtitle={t('hpp.target')}
          subtitleColor="gray"
          icon={TrendingUp}
          iconBg="bg-primary-100"
          iconColor="text-primary-600"
        />
        <StatCard
          label={t('hpp.bestProduct')}
          value={bestProduct?.name ?? '-'}
          subtitle={bestProduct ? `Margin: ${bestProduct.margin?.toFixed(1)}%` : t('hpp.noData')}
          subtitleColor="gray"
          icon={Star}
          iconBg="bg-accent-100"
          iconColor="text-accent-700"
          valueSmall
        />
        <StatCard
          label={t('hpp.needsUpdate')}
          value={String(needsUpdateCount)}
          subtitle={needsUpdateCount > 0 ? t('hpp.materialPriceUp') : t('hpp.allUpToDate')}
          subtitleColor={needsUpdateCount > 0 ? 'red' : 'green'}
          icon={AlertTriangle}
          iconBg="bg-red-100"
          iconColor="text-red-600"
        />
      </div>

      {/* Product Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('hpp.productList')}</CardTitle>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder={t('common.searchProduct')}
                value={searchQuery}
                onChange={handleSearchChange}
                className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-brand-300 focus:ring-1 focus:ring-brand-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
            {(categories.length > 0 || hasUncategorized) && (
              <div className="sm:w-52">
                <Select
                  value={categoryFilter}
                  onChange={handleCategoryChange}
                  options={[
                    { value: '', label: t('hpp.allCategories') },
                    ...categories.map((c) => ({ value: c, label: c })),
                    ...(hasUncategorized
                      ? [{ value: UNCATEGORIZED, label: t('hpp.uncategorized') }]
                      : []),
                  ]}
                />
              </div>
            )}
            <Link to="/hpp/calculate" className="sm:w-auto w-full">
              <Button variant="brand" className="w-full">
                <Plus className="h-4 w-4" />
                {t('hpp.calculateNew')}
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {report.products.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              {/* Single empty state regardless of material count —
                  the calculator wizard auto-creates supplier + bahan
                  inline, so the old "go add materials first" gate
                  was unnecessary friction. Both branches now point
                  to /hpp/calculate. */}
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {t('hpp.noProducts')}
              </p>
              <p className="mt-1 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('hpp.noProductsDesc')}
              </p>
              <Link to="/hpp/calculate" className="mt-4">
                <Button variant="brand">
                  <Plus className="h-4 w-4" />
                  {t('hpp.calculateNew')}
                </Button>
              </Link>
            </div>
          ) : filteredProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {searchQuery.trim()
                ? t('common.noSearchResult', { query: searchQuery })
                : t('hpp.noFilterResult')}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('hpp.productName')}</TableHead>
                    <TableHead>{t('hpp.category')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('hpp.date')}</TableHead>
                    <TableHead>{t('hpp.hppPerUnit')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('hpp.sellingPrice')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('hpp.margin')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProducts.map((product) => (
                    <TableRow
                      key={product.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(product.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {(() => {
                            const url = product.effectivePhotoKey
                              ? photoUrls[product.effectivePhotoKey]
                              : null
                            if (url) {
                              return (
                                <img
                                  src={url}
                                  alt={product.name}
                                  className="h-10 w-10 shrink-0 rounded-md object-cover"
                                  loading="lazy"
                                />
                              )
                            }
                            return (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-300 dark:bg-gray-700 dark:text-gray-500">
                                <Package className="h-4 w-4" />
                              </div>
                            )
                          })()}
                          <span className="font-medium">{product.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-500 dark:text-gray-400">
                        {product.category || '-'}
                      </TableCell>
                      <TableCell className="hidden text-gray-500 sm:table-cell dark:text-gray-400">
                        {formatDate(product.updatedAt)}
                      </TableCell>
                      <TableCell>
                        {product.hpp !== null
                          ? formatRupiah(
                              perUnitHpp(product.hpp, Number(product.productionQty)),
                            )
                          : '-'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{formatRupiah(product.sellingPrice)}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <MarginBadge margin={product.margin} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-gray-200 px-2 pt-4 mt-4 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('common.showing')} {(safePage - 1) * PAGE_SIZE + 1}&ndash;{Math.min(safePage * PAGE_SIZE, filteredProducts.length)} {t('common.of')} {filteredProducts.length} {t('common.product')}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {safePage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Product detail modal */}
      <ProductDetailDialog
        productId={detailId}
        onClose={() => setDetailId(null)}
        onDelete={(id) => setDeletingId(id)}
        onDuplicated={() => {
          invalidateTenantProducts(queryClient)
          router.invalidate()
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletingId}
        onCancel={() => setDeletingId(null)}
        onConfirm={handleDeleteProduct}
        title={t('hpp.deleteProduct')}
        description={t('hpp.deleteProductConfirm')}
        confirmText={t('common.delete')}
        variant="danger"
        loading={mutationLoading}
      />
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────

interface StatCardProps {
  label: string
  value: string
  subtitle: string
  subtitleColor: 'green' | 'red' | 'gray'
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  valueSmall?: boolean
}

function StatCard({
  label,
  value,
  subtitle,
  subtitleColor,
  icon: Icon,
  iconBg,
  iconColor,
  valueSmall,
}: StatCardProps) {
  const subtitleColors = {
    green: 'text-brand-600 dark:text-brand-400',
    red: 'text-red-600 dark:text-red-400',
    gray: 'text-gray-500 dark:text-gray-400',
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
            <p
              className={`mt-1 font-bold text-gray-900 truncate dark:text-gray-100 ${
                valueSmall ? 'text-lg' : 'text-2xl'
              }`}
            >
              {value}
            </p>
            <p className={`mt-1 text-xs ${subtitleColors[subtitleColor]}`}>
              {subtitle}
            </p>
          </div>
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
          >
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
