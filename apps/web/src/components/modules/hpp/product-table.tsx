import { Pencil, Trash2, ChefHat, Package } from 'lucide-react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah } from '@/lib/currency'
import { MarginBadge } from './margin-badge'

interface Product {
  id: string
  name: string
  category: string | null
  sellingPrice: number
  hpp: number | null
  margin: number | null
}

interface ProductTableProps {
  products: Product[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onViewRecipe: (id: string) => void
}

export function ProductTable({
  products,
  onEdit,
  onDelete,
  onViewRecipe,
}: ProductTableProps) {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title="Belum ada produk"
        description="Tambahkan produk yang Anda jual untuk mulai menghitung HPP dan margin keuntungan."
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nama Produk</TableHead>
          <TableHead>Kategori</TableHead>
          <TableHead>Harga Jual</TableHead>
          <TableHead>HPP</TableHead>
          <TableHead>Margin</TableHead>
          <TableHead className="text-right">Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id}>
            <TableCell className="font-medium">{product.name}</TableCell>
            <TableCell className="text-gray-500">
              {product.category ?? '-'}
            </TableCell>
            <TableCell>{formatRupiah(product.sellingPrice)}</TableCell>
            <TableCell>
              {product.hpp !== null ? formatRupiah(product.hpp) : '-'}
            </TableCell>
            <TableCell>
              <MarginBadge margin={product.margin} />
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onViewRecipe(product.id)}
                  aria-label={`Lihat resep ${product.name}`}
                  title="Resep / Komposisi"
                >
                  <ChefHat className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(product.id)}
                  aria-label={`Edit ${product.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(product.id)}
                  aria-label={`Hapus ${product.name}`}
                >
                  <Trash2 className="h-4 w-4 text-danger-500" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { type ProductTableProps, type Product }
