import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, Pencil, Trash2, Truck, Package, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah, formatRupiahDecimal } from '@/lib/currency'
import { cn } from '@/lib/utils'

interface Supplier {
  id: string
  name: string
  address: string | null
  phoneNumber: string | null
  personInCharge: string | null
  notes: string | null
  createdAt: Date
}

interface Material {
  id: string
  name: string
  brand: string | null
  unit: string
  pricePerUnit: string
  purchasePrice: string | null
  purchaseQty: string | null
  supplierId: string | null
  supplierName: string | null
  createdAt: Date
}

interface SupplierTableProps {
  suppliers: Supplier[]
  materials: Material[]
  onEditSupplier: (id: string) => void
  onDeleteSupplier: (id: string) => void
  onAddMaterial: (supplierId: string | null) => void
  onEditMaterial: (material: Material) => void
  onDeleteMaterial: (id: string) => void
}

function MaterialRows({
  materials,
  supplierName,
  onAdd,
  onEdit,
  onDelete,
}: {
  materials: Material[]
  supplierName: string
  onAdd: () => void
  onEdit: (material: Material) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('suppliers.materialsFromSupplier', { supplierName, count: materials.length })}
        </span>
        <button
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/30"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('suppliers.addMaterialButton')}
        </button>
      </div>

      {materials.length === 0 ? (
        <p className="py-3 text-sm text-gray-500 italic dark:text-gray-400">
          {t('suppliers.noMaterialsFromSupplier')}
        </p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100/50 text-left dark:border-gray-700 dark:bg-gray-700/50">
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colMaterial')}
                </th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colBrand')}
                </th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colUnit')}
                </th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPurchasePrice')}
                </th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPackageQty')}
                </th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPricePerUnit')}
                </th>
                <th className="w-[80px] px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id} className="border-b border-gray-50 last:border-0 dark:border-gray-700">
                  <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{m.name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{m.brand || '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{m.unit}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {m.purchasePrice ? formatRupiah(Number(m.purchasePrice)) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {m.purchaseQty ? Number(m.purchaseQty) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{formatRupiahDecimal(Number(m.pricePerUnit))}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        onClick={() => onEdit(m)}
                        aria-label={t('suppliers.ariaEdit', { name: m.name })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                        onClick={() => onDelete(m.id)}
                        aria-label={t('suppliers.ariaDelete', { name: m.name })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function SupplierTable({
  suppliers,
  materials,
  onEditSupplier,
  onDeleteSupplier,
  onAddMaterial,
  onEditMaterial,
  onDeleteMaterial,
}: SupplierTableProps) {
  const { t } = useTranslation()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  function getMaterialsForSupplier(supplierId: string) {
    return materials.filter((m) => m.supplierId === supplierId)
  }

  const orphanMaterials = materials.filter((m) => m.supplierId === null)

  if (suppliers.length === 0 && orphanMaterials.length === 0) {
    return (
      <EmptyState
        icon={<Truck className="h-6 w-6" />}
        title={t('suppliers.emptySupplierTitle')}
        description={t('suppliers.emptySupplierDesc')}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-900">
                <th className="w-[48px] px-3 py-2.5" />
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colSupplierName')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colMaterialCount')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colAddress')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPhone')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPic')}
                </th>
                <th className="w-[96px] px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => {
                const isExpanded = expandedId === supplier.id
                const supplierMaterials = getMaterialsForSupplier(supplier.id)

                return (
                  <DesktopSupplierRow
                    key={supplier.id}
                    supplier={supplier}
                    isExpanded={isExpanded}
                    materialCount={supplierMaterials.length}
                    onToggle={() => toggleExpand(supplier.id)}
                    onEdit={() => onEditSupplier(supplier.id)}
                    onDelete={() => onDeleteSupplier(supplier.id)}
                  >
                    <MaterialRows
                      materials={supplierMaterials}
                      supplierName={supplier.name}
                      onAdd={() => onAddMaterial(supplier.id)}
                      onEdit={onEditMaterial}
                      onDelete={onDeleteMaterial}
                    />
                  </DesktopSupplierRow>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="space-y-3 md:hidden">
        {suppliers.map((supplier) => {
          const isExpanded = expandedId === supplier.id
          const supplierMaterials = getMaterialsForSupplier(supplier.id)

          return (
            <MobileSupplierCard
              key={supplier.id}
              supplier={supplier}
              isExpanded={isExpanded}
              materialCount={supplierMaterials.length}
              onToggle={() => toggleExpand(supplier.id)}
              onEdit={() => onEditSupplier(supplier.id)}
              onDelete={() => onDeleteSupplier(supplier.id)}
            >
              <MaterialRows
                materials={supplierMaterials}
                supplierName={supplier.name}
                onAdd={() => onAddMaterial(supplier.id)}
                onEdit={onEditMaterial}
                onDelete={onDeleteMaterial}
              />
            </MobileSupplierCard>
          )
        })}
      </div>

      {/* Orphan materials (no supplier) */}
      {orphanMaterials.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4 dark:border-gray-600 dark:bg-gray-900/50">
          <MaterialRows
            materials={orphanMaterials}
            supplierName={t('suppliers.noSupplier')}
            onAdd={() => onAddMaterial(null)}
            onEdit={onEditMaterial}
            onDelete={onDeleteMaterial}
          />
        </div>
      )}
    </div>
  )
}

function DesktopSupplierRow({
  supplier,
  isExpanded,
  materialCount,
  onToggle,
  onEdit,
  onDelete,
  children,
}: {
  supplier: Supplier
  isExpanded: boolean
  materialCount: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight

  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b transition-colors hover:bg-gray-50/50 dark:hover:bg-gray-700/50',
          isExpanded ? 'border-gray-200 bg-gray-50/30 dark:border-gray-700 dark:bg-gray-800/30' : 'border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800',
        )}
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              isExpanded
                ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
            )}
          >
            <ChevronIcon className="h-4 w-4" />
          </div>
        </td>
        <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">
          {supplier.name}
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className="gap-1 text-xs">
            <Package className="h-3 w-3" />
            {t('suppliers.materialsBadge', { count: materialCount })}
          </Badge>
        </td>
        <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{supplier.address ?? '—'}</td>
        <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{supplier.phoneNumber ?? '—'}</td>
        <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{supplier.personInCharge ?? '—'}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              onClick={onEdit}
              aria-label={t('suppliers.ariaEdit', { name: supplier.name })}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              onClick={onDelete}
              aria-label={t('suppliers.ariaDelete', { name: supplier.name })}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={7} className="border-b border-gray-200 bg-gray-50/70 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/70">
            {children}
          </td>
        </tr>
      )}
    </>
  )
}

function MobileSupplierCard({
  supplier,
  isExpanded,
  materialCount,
  onToggle,
  onEdit,
  onDelete,
  children,
}: {
  supplier: Supplier
  isExpanded: boolean
  materialCount: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className={cn(
      'rounded-xl border bg-white transition-colors dark:bg-gray-800',
      isExpanded ? 'border-brand-200 dark:border-brand-700' : 'border-gray-200 dark:border-gray-700',
    )}>
      <div
        className="flex cursor-pointer items-start gap-3 p-4"
        onClick={onToggle}
      >
        <div
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
            isExpanded
              ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100">{supplier.name}</span>
            <Badge variant="outline" className="gap-1 text-xs">
              <Package className="h-3 w-3" />
              {t('suppliers.materialsBadge', { count: materialCount })}
            </Badge>
          </div>
          {supplier.address && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{supplier.address}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            {supplier.phoneNumber && <span>{supplier.phoneNumber}</span>}
            {supplier.personInCharge && <span>{t('suppliers.picLabel', { name: supplier.personInCharge })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            onClick={onEdit}
            aria-label={t('suppliers.ariaEdit', { name: supplier.name })}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
            onClick={onDelete}
            aria-label={t('suppliers.ariaDelete', { name: supplier.name })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/70">
          {children}
        </div>
      )}
    </div>
  )
}

export { type SupplierTableProps, type Supplier, type Material as SupplierMaterial }
