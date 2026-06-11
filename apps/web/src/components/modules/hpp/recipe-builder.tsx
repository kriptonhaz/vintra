import { useState } from 'react'
import { Plus, Trash2, ChefHat } from 'lucide-react'
import { UNITS } from '@vintra/shared'
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
import { formatRupiah, formatRupiahDecimal } from '@/lib/currency'
import { calculateMaterialCost } from '@/lib/hpp-calculator'
import { cn } from '@/lib/utils'

interface RecipeItem {
  id: string
  materialId: string
  materialName: string
  quantity: string
  unit: string
  pricePerUnit: string
}

interface AvailableMaterial {
  id: string
  name: string
  unit: string
  pricePerUnit: string
}

interface RecipeBuilderProps {
  productId: string
  productName: string
  items: RecipeItem[]
  availableMaterials: AvailableMaterial[]
  onAdd: (data: { materialId: string; quantity: string; unit: string }) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, data: { quantity: string; unit: string }) => void
  loading?: boolean
}

const unitOptions = UNITS.map((u) => ({ value: u.value, label: u.label }))

export function RecipeBuilder({
  productName,
  items,
  availableMaterials,
  onAdd,
  onRemove,
  onUpdate,
  loading = false,
}: RecipeBuilderProps) {
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [newUnit, setNewUnit] = useState('')
  const [addError, setAddError] = useState('')

  // Filter out materials already in the recipe
  const usedMaterialIds = new Set(items.map((item) => item.materialId))
  const unusedMaterials = availableMaterials.filter(
    (m) => !usedMaterialIds.has(m.id),
  )

  // When a material is selected, auto-fill the unit
  function handleMaterialSelect(materialId: string) {
    setSelectedMaterialId(materialId)
    setAddError('')
    const material = availableMaterials.find((m) => m.id === materialId)
    if (material) {
      setNewUnit(material.unit)
    }
  }

  function handleAdd() {
    if (!selectedMaterialId) {
      setAddError('Pilih bahan baku terlebih dahulu')
      return
    }

    if (!newQuantity || Number(newQuantity) <= 0) {
      setAddError('Jumlah pemakaian wajib diisi')
      return
    }

    if (!newUnit) {
      setAddError('Satuan wajib dipilih')
      return
    }

    onAdd({
      materialId: selectedMaterialId,
      quantity: newQuantity,
      unit: newUnit,
    })

    setSelectedMaterialId('')
    setNewQuantity('')
    setNewUnit('')
    setAddError('')
  }

  // Calculate item cost
  function getItemCost(item: RecipeItem): number {
    return calculateMaterialCost(Number(item.pricePerUnit), Number(item.quantity))
  }

  // Calculate total material cost
  const totalMaterialCost = items.reduce(
    (sum, item) => sum + getItemCost(item),
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ChefHat className="h-5 w-5 text-primary-600" />
        <h3 className="text-base font-semibold text-gray-900">
          Resep: {productName}
        </h3>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ChefHat className="h-6 w-6" />}
          title="Belum ada bahan dalam resep"
          description="Tambahkan bahan baku yang digunakan untuk membuat produk ini."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bahan Baku</TableHead>
              <TableHead>Jumlah</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead>Harga/Satuan</TableHead>
              <TableHead>Subtotal</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  {item.materialName}
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={item.quantity}
                    onChange={(e) =>
                      onUpdate(item.id, {
                        quantity: e.target.value,
                        unit: item.unit,
                      })
                    }
                    disabled={loading}
                    className={cn(
                      'h-8 w-20 rounded-md border border-gray-300 bg-white px-2 text-sm',
                      'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  />
                </TableCell>
                <TableCell>
                  <select
                    value={item.unit}
                    onChange={(e) =>
                      onUpdate(item.id, {
                        quantity: item.quantity,
                        unit: e.target.value,
                      })
                    }
                    disabled={loading}
                    className={cn(
                      'h-8 rounded-md border border-gray-300 bg-white px-2 text-sm',
                      'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  >
                    {unitOptions.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="text-gray-500">
                  {formatRupiahDecimal(Number(item.pricePerUnit))}
                </TableCell>
                <TableCell className="font-medium">
                  {formatRupiah(getItemCost(item))}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(item.id)}
                      disabled={loading}
                      aria-label={`Hapus ${item.materialName} dari resep`}
                    >
                      <Trash2 className="h-4 w-4 text-danger-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add material row */}
      <div className="rounded-lg border border-dashed border-gray-300 p-4">
        <p className="mb-3 text-sm font-medium text-gray-700">
          Tambah Bahan Baku
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1.5 block text-xs text-gray-500">
              Bahan Baku
            </label>
            <select
              value={selectedMaterialId}
              onChange={(e) => handleMaterialSelect(e.target.value)}
              disabled={loading || unusedMaterials.length === 0}
              className={cn(
                'flex h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <option value="">
                {unusedMaterials.length === 0
                  ? 'Semua bahan sudah ditambahkan'
                  : 'Pilih bahan baku'}
              </option>
              {unusedMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({formatRupiahDecimal(Number(m.pricePerUnit))}/{m.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="w-28">
            <label className="mb-1.5 block text-xs text-gray-500">
              Jumlah
            </label>
            <input
              type="number"
              step="any"
              min="0"
              placeholder="0"
              value={newQuantity}
              onChange={(e) => {
                setNewQuantity(e.target.value)
                setAddError('')
              }}
              disabled={loading}
              className={cn(
                'flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm',
                'placeholder:text-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </div>

          <div className="w-32">
            <label className="mb-1.5 block text-xs text-gray-500">
              Satuan
            </label>
            <select
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              disabled={loading}
              className={cn(
                'flex h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <option value="">Pilih</option>
              {unitOptions.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            size="md"
            onClick={handleAdd}
            disabled={loading || unusedMaterials.length === 0}
          >
            <Plus className="h-4 w-4" />
            Tambah
          </Button>
        </div>

        {addError && (
          <p className="mt-2 text-xs text-danger-500">{addError}</p>
        )}
      </div>

      {/* Total */}
      {items.length > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-gray-700">
            Total Biaya Bahan Baku
          </span>
          <span className="text-base font-semibold text-gray-900">
            {formatRupiah(totalMaterialCost)}
          </span>
        </div>
      )}
    </div>
  )
}

export { type RecipeBuilderProps, type RecipeItem, type AvailableMaterial }
