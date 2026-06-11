import { Pencil, Trash2, Package } from 'lucide-react'
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
import { formatRupiahDecimal } from '@/lib/currency'
import { formatDate } from '@/lib/utils'

interface Material {
  id: string
  name: string
  unit: string
  pricePerUnit: string
  supplierId: string | null
  supplierName: string | null
  createdAt: Date
}

interface MaterialTableProps {
  materials: Material[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export function MaterialTable({ materials, onEdit, onDelete }: MaterialTableProps) {
  if (materials.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title="Belum ada bahan baku"
        description="Mulai tambahkan bahan baku yang digunakan dalam produk Anda untuk menghitung HPP."
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nama Bahan</TableHead>
          <TableHead>Satuan</TableHead>
          <TableHead>Harga/Satuan</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Ditambahkan</TableHead>
          <TableHead className="text-right">Aksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map((material) => (
          <TableRow key={material.id}>
            <TableCell className="font-medium">{material.name}</TableCell>
            <TableCell>{material.unit}</TableCell>
            <TableCell>{formatRupiahDecimal(Number(material.pricePerUnit))}</TableCell>
            <TableCell className="text-gray-500">
              {material.supplierName ?? '-'}
            </TableCell>
            <TableCell className="text-gray-500">
              {formatDate(material.createdAt)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(material.id)}
                  aria-label={`Edit ${material.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(material.id)}
                  aria-label={`Hapus ${material.name}`}
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

export { type MaterialTableProps, type Material }
