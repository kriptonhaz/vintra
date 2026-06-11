import { Pencil, Trash2, Calculator } from 'lucide-react'
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

interface Overhead {
  id: string
  name: string
  amount: number
  period: string
  allocationType: string
  monthlyAmount: number
}

interface OverheadTableProps {
  overheads: Overhead[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

const periodLabels: Record<string, string> = {
  daily: 'Harian',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
}

const allocationLabels: Record<string, string> = {
  per_product: 'Per Produk',
  percentage: 'Persentase',
}

export function OverheadTable({ overheads, onEdit, onDelete }: OverheadTableProps) {
  if (overheads.length === 0) {
    return (
      <EmptyState
        icon={<Calculator className="h-6 w-6" />}
        title="Belum ada biaya overhead"
        description="Tambahkan biaya operasional seperti sewa, listrik, dan gas untuk perhitungan HPP yang lebih akurat."
      />
    )
  }

  const totalMonthly = overheads.reduce((sum, o) => sum + o.monthlyAmount, 0)

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama Biaya</TableHead>
            <TableHead>Jumlah</TableHead>
            <TableHead>Periode</TableHead>
            <TableHead>Alokasi</TableHead>
            <TableHead>Biaya Bulanan</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overheads.map((overhead) => (
            <TableRow key={overhead.id}>
              <TableCell className="font-medium">{overhead.name}</TableCell>
              <TableCell>{formatRupiah(overhead.amount)}</TableCell>
              <TableCell className="text-gray-500">
                {periodLabels[overhead.period] ?? overhead.period}
              </TableCell>
              <TableCell className="text-gray-500">
                {allocationLabels[overhead.allocationType] ?? overhead.allocationType}
              </TableCell>
              <TableCell className="font-medium">
                {formatRupiah(overhead.monthlyAmount)}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(overhead.id)}
                    aria-label={`Edit ${overhead.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(overhead.id)}
                    aria-label={`Hapus ${overhead.name}`}
                  >
                    <Trash2 className="h-4 w-4 text-danger-500" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
        <span className="text-sm font-medium text-gray-700">
          Total Biaya Overhead Bulanan
        </span>
        <span className="text-base font-semibold text-gray-900">
          {formatRupiah(totalMonthly)}
        </span>
      </div>
    </div>
  )
}

export { type OverheadTableProps, type Overhead }
