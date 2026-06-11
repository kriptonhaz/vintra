import { useTranslation } from 'react-i18next'
import { Pencil, Trash2, Package } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah, formatRupiahDecimal } from '@/lib/currency'

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

interface MaterialListTableProps {
  materials: Material[]
  onEditMaterial: (material: Material) => void
  onDeleteMaterial: (id: string) => void
}

export function MaterialListTable({
  materials,
  onEditMaterial,
  onDeleteMaterial,
}: MaterialListTableProps) {
  const { t } = useTranslation()

  if (materials.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title={t('suppliers.emptyMaterialTitle')}
        description={t('suppliers.emptyMaterialDesc')}
      />
    )
  }

  return (
    <div>
      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-900">
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colName')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colBrand')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colSupplier')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colUnit')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPurchasePrice')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPackageSize')}
                </th>
                <th className="px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colPricePerUnit')}
                </th>
                <th className="w-[96px] px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('suppliers.colActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-gray-100 bg-white transition-colors hover:bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/50"
                >
                  <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {m.name}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">
                    {m.brand || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {m.supplierName ? (
                      <span className="text-gray-600 dark:text-gray-400">{m.supplierName}</span>
                    ) : (
                      <span className="text-gray-400 italic dark:text-gray-500">{t('suppliers.noSupplierItalic')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">{m.unit}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">
                    {m.purchasePrice
                      ? formatRupiah(Number(m.purchasePrice))
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">
                    {m.purchaseQty ? Number(m.purchaseQty) : '—'}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-700 dark:text-gray-300">
                    {formatRupiahDecimal(Number(m.pricePerUnit))}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        onClick={() => onEditMaterial(m)}
                        aria-label={t('suppliers.ariaEdit', { name: m.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                        onClick={() => onDeleteMaterial(m.id)}
                        aria-label={t('suppliers.ariaDelete', { name: m.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="space-y-3 md:hidden">
        {materials.map((m) => (
          <div
            key={m.id}
            className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {m.name}
                  {m.brand && (
                    <span className="ml-1.5 text-sm font-normal text-gray-400 dark:text-gray-500">
                      ({m.brand})
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {m.supplierName ? (
                    m.supplierName
                  ) : (
                    <span className="italic">{t('suppliers.noSupplierItalic')}</span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{m.unit}</span>
                  {m.purchasePrice && m.purchaseQty && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {formatRupiah(Number(m.purchasePrice))} / {Number(m.purchaseQty)} pcs
                    </span>
                  )}
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {formatRupiahDecimal(Number(m.pricePerUnit))}{t('suppliers.pricePerUnit')}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  onClick={() => onEditMaterial(m)}
                  aria-label={t('suppliers.ariaEdit', { name: m.name })}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  onClick={() => onDeleteMaterial(m.id)}
                  aria-label={t('suppliers.ariaDelete', { name: m.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export { type MaterialListTableProps, type Material as MaterialListItem }
