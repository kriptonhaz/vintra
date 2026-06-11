import { useState, useMemo } from 'react'
import { useHppUnits } from '@/hooks/use-master-data'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  invalidateTenantSuppliers,
  invalidateTenantMaterials,
} from '@/lib/invalidate'
import {
  getSuppliers,
  getMaterials,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  createMaterial,
  updateMaterial,
  deleteMaterial,
} from '@/server/functions/hpp'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  SupplierForm,
  type SupplierFormData,
} from '@/components/modules/hpp/supplier-form'
import {
  MaterialForm,
  type MaterialFormData,
} from '@/components/modules/hpp/material-form'
import { SupplierTable } from '@/components/modules/hpp/supplier-table'
import type { SupplierMaterial } from '@/components/modules/hpp/supplier-table'
import { MaterialListTable } from '@/components/modules/hpp/material-list-table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, Truck, Package, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/master/suppliers')({
  loader: async () => {
    const [suppliers, materials] = await Promise.all([
      getSuppliers(),
      getMaterials(),
    ])
    return { suppliers, materials }
  },
  component: SuppliersPage,
})

type ViewMode = 'supplier' | 'material'

function SuppliersPage() {
  const { suppliers, materials } = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  // JUR-14: form passes unit text; createMaterial/updateMaterial now
  // expect unitId. Translate via the master units cache.
  const { data: units = [] } = useHppUnits()
  const unitIdByValue = useMemo(
    () => new Map(units.map((u) => [u.value, u.id])),
    [units],
  )

  const [view, setView] = useState<ViewMode>('supplier')

  // Search & filter state (per tab)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [materialSearch, setMaterialSearch] = useState('')
  const [materialSupplierFilter, setMaterialSupplierFilter] = useState('')

  // Supplier state
  const [showCreateSupplierSheet, setShowCreateSupplierSheet] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<
    (typeof suppliers)[number] | null
  >(null)
  const [deletingSupplierIds, setDeletingSupplierIds] = useState<string | null>(null)

  // Material state
  const [addMaterialSupplierId, setAddMaterialSupplierId] = useState<string | null | undefined>(undefined)
  const [editingMaterial, setEditingMaterial] = useState<SupplierMaterial | null>(null)
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(null)

  const [mutationLoading, setMutationLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)


  // ─── Supplier handlers ──────────────────────────────

  async function handleCreateSupplier(data: SupplierFormData) {
    setMutationLoading(true)
    setError(null)
    try {
      await createSupplier({ data })
      setShowCreateSupplierSheet(false)
      invalidateTenantSuppliers(queryClient)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambahkan supplier')
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleUpdateSupplier(data: SupplierFormData) {
    if (!editingSupplier) return
    setMutationLoading(true)
    setError(null)
    try {
      await updateSupplier({ data: { id: editingSupplier.id, ...data } })
      setEditingSupplier(null)
      invalidateTenantSuppliers(queryClient)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui supplier')
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleDeleteSupplier() {
    if (!deletingSupplierIds) return
    setMutationLoading(true)
    setError(null)
    try {
      await deleteSupplier({ data: { id: deletingSupplierIds } })
      setDeletingSupplierIds(null)
      invalidateTenantSuppliers(queryClient)
      // Materials carry a supplier FK that goes null on cascade; the
      // material list ought to refresh too.
      invalidateTenantMaterials(queryClient)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus supplier')
    } finally {
      setMutationLoading(false)
    }
  }

  // ─── Material handlers ──────────────────────────────

  async function handleCreateMaterial(data: MaterialFormData) {
    setMutationLoading(true)
    setError(null)
    try {
      let supplierId = data.supplierId

      // Auto-create supplier if new supplier name is provided
      if (!supplierId && data.supplierName) {
        const newSupplier = await createSupplier({
          data: {
            name: data.supplierName,
            address: data.supplierAddress,
            phoneNumber: data.supplierPhone,
            personInCharge: data.supplierPic,
            notes: data.supplierNotes,
          },
        })
        supplierId = newSupplier.id
      }

      const unitId = unitIdByValue.get(data.unit)
      if (!unitId) {
        throw new Error(`Satuan "${data.unit}" tidak ditemukan`)
      }
      await createMaterial({
        data: {
          name: data.name,
          brand: data.brand,
          unitId,
          purchasePrice: data.purchasePrice,
          purchaseQty: data.purchaseQty,
          supplierId,
          notes: data.notes,
        },
      })
      setAddMaterialSupplierId(undefined)
      // Material handler may auto-create a supplier inline, so invalidate
      // both axes.
      invalidateTenantMaterials(queryClient)
      invalidateTenantSuppliers(queryClient)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambahkan bahan baku')
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleUpdateMaterial(data: MaterialFormData) {
    if (!editingMaterial) return
    setMutationLoading(true)
    setError(null)
    try {
      let supplierId = data.supplierId

      // Auto-create supplier if new supplier name is provided
      if (!supplierId && data.supplierName) {
        const newSupplier = await createSupplier({
          data: {
            name: data.supplierName,
            address: data.supplierAddress,
            phoneNumber: data.supplierPhone,
            personInCharge: data.supplierPic,
            notes: data.supplierNotes,
          },
        })
        supplierId = newSupplier.id
      }

      const unitId = unitIdByValue.get(data.unit)
      if (!unitId) {
        throw new Error(`Satuan "${data.unit}" tidak ditemukan`)
      }
      await updateMaterial({
        data: {
          id: editingMaterial.id,
          name: data.name,
          brand: data.brand,
          unitId,
          purchasePrice: data.purchasePrice,
          purchaseQty: data.purchaseQty,
          supplierId,
          notes: data.notes,
        },
      })
      setEditingMaterial(null)
      invalidateTenantMaterials(queryClient)
      invalidateTenantSuppliers(queryClient)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui bahan baku')
    } finally {
      setMutationLoading(false)
    }
  }

  async function handleDeleteMaterial() {
    if (!deletingMaterialId) return
    setMutationLoading(true)
    setError(null)
    try {
      await deleteMaterial({ data: { id: deletingMaterialId } })
      setDeletingMaterialId(null)
      invalidateTenantMaterials(queryClient)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus bahan baku')
    } finally {
      setMutationLoading(false)
    }
  }

  // ─── Lookup helpers ─────────────────────────────────

  const deletingSupplier = deletingSupplierIds
    ? suppliers.find((s) => s.id === deletingSupplierIds)
    : null

  const deletingMaterial = deletingMaterialId
    ? materials.find((m) => m.id === deletingMaterialId)
    : null

  const addMaterialSupplierName =
    addMaterialSupplierId === null
      ? t('suppliers.noSupplier')
      : suppliers.find((s) => s.id === addMaterialSupplierId)?.name ?? ''

  // ─── Search & filter ────────────────────────────────

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) =>
      [s.name, s.address, s.phoneNumber, s.personInCharge]
        .some((field) => (field ?? '').toLowerCase().includes(q)),
    )
  }, [suppliers, supplierSearch])

  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase()
    return materials.filter((m) => {
      if (materialSupplierFilter === 'none' && m.supplierId !== null) return false
      if (
        materialSupplierFilter &&
        materialSupplierFilter !== 'none' &&
        m.supplierId !== materialSupplierFilter
      ) {
        return false
      }
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        (m.brand ?? '').toLowerCase().includes(q)
      )
    })
  }, [materials, materialSearch, materialSupplierFilter])

  return (
    <div className="space-y-6">
      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Main Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t('suppliers.pageTitle')}</CardTitle>
              <CardDescription>
                {t('suppliers.pageDescription')}
              </CardDescription>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {view === 'supplier' ? (
                <Button variant="brand" size="sm" onClick={() => setShowCreateSupplierSheet(true)}>
                  <Plus className="h-4 w-4" />
                  {t('suppliers.addSupplier')}
                </Button>
              ) : (
                <Button variant="brand" size="sm" onClick={() => { setAddMaterialSupplierId(null); setError(null) }}>
                  <Plus className="h-4 w-4" />
                  {t('suppliers.addMaterial')}
                </Button>
              )}
            {/* View Toggle */}
            <div className="w-full rounded-lg border border-gray-200 bg-gray-50 p-0.5 sm:w-auto dark:border-gray-700 dark:bg-gray-900">
              <div className="flex">
                <button
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all sm:flex-initial',
                    view === 'supplier'
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
                  )}
                  onClick={() => setView('supplier')}
                >
                  <Truck className="h-4 w-4" />
                  {t('suppliers.viewSupplier')}
                </button>
                <button
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all sm:flex-initial',
                    view === 'material'
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
                  )}
                  onClick={() => setView('material')}
                >
                  <Package className="h-4 w-4" />
                  {t('suppliers.viewMaterial')}
                </button>
              </div>
            </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search & filter */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            {view === 'supplier' ? (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder={t('suppliers.searchSupplierPlaceholder')}
                  className="pl-9"
                />
              </div>
            ) : (
              <>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                    placeholder={t('suppliers.searchMaterialPlaceholder')}
                    className="pl-9"
                  />
                </div>
                <div className="sm:w-56">
                  <Select
                    value={materialSupplierFilter}
                    onChange={(e) => setMaterialSupplierFilter(e.target.value)}
                    options={[
                      { value: '', label: t('suppliers.allSuppliers') },
                      { value: 'none', label: t('suppliers.noSupplierFilter') },
                      ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
              </>
            )}
          </div>

          {view === 'supplier' ? (
            supplierSearch.trim() && filteredSuppliers.length === 0 ? (
              <EmptyState
                icon={<Truck className="h-6 w-6" />}
                title={t('suppliers.emptyFilteredTitle')}
                description={t('suppliers.emptyFilteredDesc')}
              />
            ) : (
              <SupplierTable
                suppliers={filteredSuppliers}
                materials={materials}
                onEditSupplier={(id) => {
                  const s = suppliers.find((s) => s.id === id)
                  if (s) { setEditingSupplier(s); setError(null) }
                }}
                onDeleteSupplier={(id) => { setDeletingSupplierIds(id); setError(null) }}
                onAddMaterial={(supplierId) => { setAddMaterialSupplierId(supplierId); setError(null) }}
                onEditMaterial={(m) => { setEditingMaterial(m); setError(null) }}
                onDeleteMaterial={(id) => { setDeletingMaterialId(id); setError(null) }}
              />
            )
          ) : (materialSearch.trim() || materialSupplierFilter) &&
            filteredMaterials.length === 0 ? (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title={t('suppliers.emptyFilteredTitle')}
              description={t('suppliers.emptyFilteredDesc')}
            />
          ) : (
            <MaterialListTable
              materials={filteredMaterials}
              onEditMaterial={(m) => { setEditingMaterial(m); setError(null) }}
              onDeleteMaterial={(id) => { setDeletingMaterialId(id); setError(null) }}
            />
          )}
        </CardContent>
      </Card>

      {/* ─── Supplier Sheets ──────────────────────────── */}

      <Sheet
        open={showCreateSupplierSheet}
        onClose={() => { if (!mutationLoading) { setShowCreateSupplierSheet(false); setError(null) } }}
      >
        <SheetHeader onClose={() => { if (!mutationLoading) { setShowCreateSupplierSheet(false); setError(null) } }}>
          <SheetTitle>{t('suppliers.sheetCreateSupplierTitle')}</SheetTitle>
          <SheetDescription>
            {t('suppliers.sheetCreateSupplierDesc')}
          </SheetDescription>
        </SheetHeader>
        <SupplierForm
          onSubmit={handleCreateSupplier}
          onCancel={() => { setShowCreateSupplierSheet(false); setError(null) }}
          loading={mutationLoading}
        />
      </Sheet>

      <Sheet
        open={editingSupplier !== null}
        onClose={() => { if (!mutationLoading) { setEditingSupplier(null); setError(null) } }}
      >
        <SheetHeader onClose={() => { if (!mutationLoading) { setEditingSupplier(null); setError(null) } }}>
          <SheetTitle>{t('suppliers.sheetEditSupplierTitle')}</SheetTitle>
          <SheetDescription>
            {t('suppliers.sheetEditSupplierDesc')}
          </SheetDescription>
        </SheetHeader>
        {editingSupplier && (
          <SupplierForm
            defaultValues={{
              name: editingSupplier.name,
              address: editingSupplier.address ?? undefined,
              phoneNumber: editingSupplier.phoneNumber ?? undefined,
              personInCharge: editingSupplier.personInCharge ?? undefined,
              notes: editingSupplier.notes ?? undefined,
            }}
            onSubmit={handleUpdateSupplier}
            onCancel={() => { setEditingSupplier(null); setError(null) }}
            loading={mutationLoading}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={deletingSupplierIds !== null}
        title={t('suppliers.deleteSupplierTitle')}
        description={
          deletingSupplier
            ? t('suppliers.deleteSupplierConfirm', { name: deletingSupplier.name })
            : t('suppliers.deleteSupplierFallback')
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        loading={mutationLoading}
        onConfirm={handleDeleteSupplier}
        onCancel={() => { setDeletingSupplierIds(null); setError(null) }}
      />

      {/* ─── Material Sheets ─────────────────────────── */}

      <Sheet
        open={addMaterialSupplierId !== undefined}
        onClose={() => { if (!mutationLoading) { setAddMaterialSupplierId(undefined); setError(null) } }}
      >
        <SheetHeader onClose={() => { if (!mutationLoading) { setAddMaterialSupplierId(undefined); setError(null) } }}>
          <SheetTitle>
            {t('suppliers.sheetCreateMaterialTitle')}
          </SheetTitle>
          <SheetDescription>
            {addMaterialSupplierName
              ? t('suppliers.sheetCreateMaterialDescWithSupplier', { supplierName: addMaterialSupplierName })
              : t('suppliers.sheetCreateMaterialDesc')}
          </SheetDescription>
        </SheetHeader>
        <MaterialForm
          onSubmit={handleCreateMaterial}
          onCancel={() => { setAddMaterialSupplierId(undefined); setError(null) }}
          loading={mutationLoading}
          suppliers={suppliers}
          fixedSupplierId={addMaterialSupplierId}
        />
      </Sheet>

      <Sheet
        open={editingMaterial !== null}
        onClose={() => { if (!mutationLoading) { setEditingMaterial(null); setError(null) } }}
      >
        <SheetHeader onClose={() => { if (!mutationLoading) { setEditingMaterial(null); setError(null) } }}>
          <SheetTitle>{t('suppliers.sheetEditMaterialTitle')}</SheetTitle>
          <SheetDescription>
            {t('suppliers.sheetEditMaterialDesc')}
          </SheetDescription>
        </SheetHeader>
        {editingMaterial && (
          <MaterialForm
            defaultValues={{
              name: editingMaterial.name,
              brand: editingMaterial.brand ?? undefined,
              unit: editingMaterial.unit,
              // DB numeric columns arrive with trailing decimals
              // ("6000.00", "19000.0000") — normalize to clean strings.
              purchasePrice: String(
                Number(editingMaterial.purchasePrice ?? editingMaterial.pricePerUnit),
              ),
              purchaseQty: String(Number(editingMaterial.purchaseQty ?? '1')),
              supplierId: editingMaterial.supplierId ?? undefined,
              supplierName: editingMaterial.supplierName ?? undefined,
              notes: undefined,
            }}
            onSubmit={handleUpdateMaterial}
            onCancel={() => { setEditingMaterial(null); setError(null) }}
            loading={mutationLoading}
            suppliers={suppliers}
          />
        )}
      </Sheet>

      <ConfirmDialog
        open={deletingMaterialId !== null}
        title={t('suppliers.deleteMaterialTitle')}
        description={
          deletingMaterial
            ? t('suppliers.deleteMaterialConfirm', { name: deletingMaterial.name })
            : t('suppliers.deleteMaterialFallback')
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        loading={mutationLoading}
        onConfirm={handleDeleteMaterial}
        onCancel={() => { setDeletingMaterialId(null); setError(null) }}
      />
    </div>
  )
}
