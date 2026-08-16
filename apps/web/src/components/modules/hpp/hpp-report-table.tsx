import { Package } from 'lucide-react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah } from '@/lib/currency'
import { perUnitHpp } from '@/lib/hpp-calculator'
import { MarginBadge } from './margin-badge'

interface ReportProduct {
  id: string
  name: string
  sellingPrice: number
  // Total cost to produce one batch (productionQty units). Profit and
  // margin are per-unit, so this is divided by productionQty before
  // being compared to the per-unit selling price.
  hpp: number | null
  productionQty: number | null
  margin: number | null
  category: string | null
}

interface HppReportTableProps {
  products: ReportProduct[]
  totalOverhead: number
}

export function HppReportTable({ products, totalOverhead }: HppReportTableProps) {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title="Belum ada data laporan"
        description="Tambahkan produk dan resep terlebih dahulu untuk melihat laporan HPP."
      />
    )
  }

  // Calculate summary statistics. The table reports per-unit economics
  // ("one of each"), so HPP totals sum the per-unit cost — not the
  // batch cost — to stay consistent with the per-unit selling price.
  const productsWithHpp = products.filter((p) => p.hpp !== null)
  const totalSellingPrice = products.reduce((sum, p) => sum + p.sellingPrice, 0)
  const totalHpp = productsWithHpp.reduce(
    (sum, p) => sum + perUnitHpp(p.hpp ?? 0, Number(p.productionQty)),
    0,
  )
  const averageMargin =
    productsWithHpp.length > 0
      ? productsWithHpp.reduce((sum, p) => sum + (p.margin ?? 0), 0) /
        productsWithHpp.length
      : null

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Total Produk</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {products.length}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Total Overhead Bulanan</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {formatRupiah(totalOverhead)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Rata-rata Margin</p>
          <p className="mt-1">
            {averageMargin !== null ? (
              <MarginBadge margin={averageMargin} />
            ) : (
              <span className="text-2xl font-semibold text-gray-400">-</span>
            )}
          </p>
        </div>
      </div>

      {/* Report table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produk</TableHead>
            <TableHead>Kategori</TableHead>
            <TableHead>HPP/Unit</TableHead>
            <TableHead>Harga Jual</TableHead>
            <TableHead>Laba/Unit</TableHead>
            <TableHead>Margin</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const unitHpp =
              product.hpp !== null
                ? perUnitHpp(product.hpp, Number(product.productionQty))
                : null
            const profit =
              unitHpp !== null ? product.sellingPrice - unitHpp : null

            return (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell className="text-gray-500">
                  {product.category ?? '-'}
                </TableCell>
                <TableCell>
                  {unitHpp !== null ? formatRupiah(unitHpp) : '-'}
                </TableCell>
                <TableCell>{formatRupiah(product.sellingPrice)}</TableCell>
                <TableCell>
                  {profit !== null ? (
                    <span
                      className={
                        profit >= 0 ? 'text-success-600' : 'text-danger-500'
                      }
                    >
                      {formatRupiah(profit)}
                    </span>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  {product.margin !== null
                    ? `${product.margin.toFixed(1)}%`
                    : '-'}
                </TableCell>
                <TableCell>
                  <MarginBadge margin={product.margin} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Summary row */}
      <div className="rounded-lg bg-gray-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-sm text-gray-500">Total HPP</span>
            <p className="font-semibold text-gray-900">
              {formatRupiah(totalHpp)}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Total Harga Jual</span>
            <p className="font-semibold text-gray-900">
              {formatRupiah(totalSellingPrice)}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Total Potensi Laba</span>
            <p className="font-semibold text-success-600">
              {formatRupiah(totalSellingPrice - totalHpp)}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Overhead/Produk</span>
            <p className="font-semibold text-gray-900">
              {products.length > 0
                ? formatRupiah(totalOverhead / products.length)
                : formatRupiah(0)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export { type HppReportTableProps, type ReportProduct }
