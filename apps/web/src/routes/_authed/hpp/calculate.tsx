import { useState, useMemo, useEffect, useCallback } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { createFileRoute } from '@tanstack/react-router'
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  invalidateTenantMaterials,
  invalidateTenantProducts,
  invalidateTenantCategories,
  invalidateTenantSuppliers,
} from '@/lib/invalidate'
import { cn, formatDate, formatNumberID } from '@/lib/utils' // JUR-137
import { formatRupiah, formatRupiahDecimal } from '@/lib/currency'
import {
  findOrCreateSupplier,
  createMaterial,
  createProduct,
  updateProduct,
  replaceProductMaterials,
  calculateProductHpp,
  setProductHpp,
  getProductForEdit,
  createTenantCategory,
  createSupplier,
  uploadHppProductPhotoFn,
  getHppPhotoUrls,
} from '@/server/functions/hpp'
import { useTenantCategories, useHppUnits, useMaterials, useSuppliers, useProducts } from '@/hooks/use-master-data'
import {
  MaterialCombobox,
  type MaterialOption,
  type ProductOption,
} from '@/components/ui/material-combobox'
import {
  SupplierCombobox,
  type SupplierOption,
} from '@/components/ui/supplier-combobox'
import {
  hppCalculateSchema,
  STEP_FIELDS,
  type HppCalculateFormData,
  type CostItemData,
} from '@/lib/schemas/hpp-calculate'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  MaterialForm,
  type MaterialFormData,
} from '@/components/modules/hpp/material-form'
import {
  Check,
  ArrowRight,
  ArrowLeft,
  Package,
  Lightbulb,
  ClipboardList,
  DollarSign,
  FileText,
  Plus,
  Trash2,
  Download,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ListChecks,
} from 'lucide-react'
import { PhotoUploadField } from '@/components/inventory/photo-upload-field'
import type { UseFormReturn } from 'react-hook-form'

interface CalculateSearchParams {
  editProductId?: string
}

export const Route = createFileRoute('/_authed/hpp/calculate')({
  validateSearch: (search: Record<string, unknown>): CalculateSearchParams => ({
    editProductId: typeof search.editProductId === 'string' ? search.editProductId : undefined,
  }),
  component: CalculatePage,
})

// ─── Step Definitions ─────────────────────────────────

const STEPS = [
  { number: 1, labelKey: 'calc.steps.infoProduk', icon: Package },
  { number: 2, labelKey: 'calc.steps.komponenBiaya', icon: ClipboardList },
  { number: 3, labelKey: 'calc.steps.hargaJual', icon: DollarSign },
  { number: 4, labelKey: 'calc.steps.ringkasan', icon: FileText },
] as const

type MasterOption = { value: string; label: string }

// ─── Helpers ─────────────────────────────────────────

function getSubtotal(item: CostItemData): number {
  const qty = parseFloat(item.quantity) || 0
  const price = parseFloat(item.pricePerUnit) || 0
  return qty * price
}

// Default values for new rows — all fields present on every item
const MATERIAL_DEFAULTS: CostItemData = {
  name: '',
  materialId: '',
  productId: '',
  brand: '',
  supplier: '',
  quantity: '',
  unit: 'gram',
  pricePerUnit: '',
  addAt: 'prep',
}


// ─── Main Page Component ──────────────────────────────

function CalculatePage() {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const { data: tenantCategoriesRaw = [], refetch: refetchCategories } = useTenantCategories()
  const categories = tenantCategoriesRaw.map((c) => ({ value: c.name, label: c.name }))
  const { data: units = [] } = useHppUnits()
  // JUR-14: form fields keep `unit` as text (the cashier's mental
  // model — "gram", "ml") but server fns expect `unitId` (FK). Build
  // a value→id lookup once and translate at submit time.
  const unitIdByValue = useMemo(
    () => new Map(units.map((u) => [u.value, u.id])),
    [units],
  )
  const resolveUnitId = useCallback(
    (text: string): string => {
      const id = unitIdByValue.get(text)
      if (!id) {
        throw new Error(`Satuan "${text}" tidak ditemukan di master units`)
      }
      return id
    },
    [unitIdByValue],
  )
  const { data: materialsRaw = [], refetch: refetchMaterials } = useMaterials()
  const { data: suppliersRaw = [], refetch: refetchSuppliers } = useSuppliers()
  const { data: productsRaw = [] } = useProducts()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  // Edit mode — fetch existing product data
  const { editProductId } = Route.useSearch()
  const isEditMode = !!editProductId
  const [editDataLoaded, setEditDataLoaded] = useState(false)

  // Photo (Item 3 UI/UX review). The wizard owns the data URL the
  // user picked + a preview URL we seed from an existing photo in
  // edit mode. Upload is fired separately after createProduct /
  // updateProduct succeeds so a photo failure can't leave the product
  // half-created.
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [photoChanged, setPhotoChanged] = useState(false)

  // Map to MaterialOption shape for combobox
  const materialOptions: MaterialOption[] = useMemo(
    () =>
      materialsRaw.map((m) => ({
        id: m.id,
        name: m.name,
        brand: m.brand,
        unit: m.unit,
        pricePerUnit: m.pricePerUnit,
        supplierId: m.supplierId,
        supplierName: m.supplierName,
      })),
    [materialsRaw],
  )

  // Map to SupplierOption shape for combobox
  const supplierOptions: SupplierOption[] = useMemo(
    () => suppliersRaw.map((s) => ({ id: s.id, name: s.name })),
    [suppliersRaw],
  )

  // Products with calculated HPP — available as cost items
  const productOptions: ProductOption[] = useMemo(
    () =>
      productsRaw
        .filter((p) => p.hpp !== null && p.hpp !== undefined)
        .map((p) => {
          const totalHpp = Number(p.hpp)
          const rawQty = Number(p.productionQty)
          const prodQty = rawQty > 0 ? rawQty : 1
          return {
            id: p.id,
            name: p.name,
            hpp: totalHpp / prodQty,
            unit: p.productionUnit || 'porsi',
          }
        }),
    [productsRaw],
  )

  const form = useForm<HppCalculateFormData>({
    resolver: zodResolver(hppCalculateSchema),
    defaultValues: {
      productName: '',
      sku: '',
      category: '',
      productionQty: '1',
      productionUnit: 'porsi',
      notes: '',
      costItems: [],
      targetMargin: '40',
      sellingPrice: '',
      competitors: { a: '', b: '', c: '' },
    },
    mode: 'onTouched',
  })

  // Load existing product data for edit mode (wait for categories to be available)
  useEffect(() => {
    if (!editProductId || editDataLoaded || categories.length === 0) return
    let cancelled = false

    async function loadProduct() {
      try {
        const { product, materials: bom } = await getProductForEdit({
          data: { productId: editProductId! },
        })
        if (cancelled) return

        form.reset({
          productName: product.name,
          sku: product.sku || '',
          category: product.category || '',
          productionQty: product.productionQty ? String(Number(product.productionQty)) : '1',
          productionUnit: product.productionUnit || 'porsi',
          notes: product.notes || '',
          // BOM rows come in two shapes (DB CHECK enforces XOR):
          //   - material-sourced (materialId set) — populate the
          //     material side of the form row
          //   - sub-product-sourced (sourceProductId set) — populate
          //     productId + name from the source product and derive
          //     pricePerUnit the same way productOptions does
          //     (totalHpp / productionQty) so re-saving keeps the
          //     same numbers.
          costItems: bom.map((item) => {
            if (item.sourceProductId) {
              const totalHpp = Number(item.sourceHpp ?? 0)
              const rawQty = Number(item.sourceProductionQty ?? 1)
              const prodQty = rawQty > 0 ? rawQty : 1
              const perUnit = prodQty > 0 ? totalHpp / prodQty : totalHpp
              return {
                name: item.sourceName ?? '',
                materialId: '',
                productId: item.sourceProductId,
                brand: '',
                supplier: '',
                quantity: String(Number(item.quantity)),
                unit: item.unit,
                pricePerUnit: String(perUnit),
                addAt: (item.addAt as 'prep' | 'finish' | undefined) ?? 'prep',
              }
            }
            return {
              name: item.materialName ?? '',
              materialId: item.materialId ?? '',
              productId: '',
              brand: item.materialBrand || '',
              supplier: item.supplierName || '',
              quantity: String(Number(item.quantity)),
              unit: item.unit,
              pricePerUnit: item.pricePerUnit ?? '0',
              addAt: (item.addAt as 'prep' | 'finish' | undefined) ?? 'prep',
            }
          }),
          targetMargin: product.margin ? String(Math.abs(Number(product.margin))) : '40',
          sellingPrice: String(product.sellingPrice),
          competitors: { a: '', b: '', c: '' },
        })
        setEditDataLoaded(true)

        // Seed the photo preview from the saved key. We pass the
        // signed URL as the PhotoUploadField value; photoChanged stays
        // false so we don't re-upload it unless the user picks a new
        // image. Failures (network, missing key) just fall through to
        // the placeholder — non-fatal.
        if (product.photoKey) {
          try {
            const urls = await getHppPhotoUrls({
              data: { keys: [product.photoKey] },
            })
            if (!cancelled) {
              const url = urls[product.photoKey]
              if (url) setPhotoDataUrl(url)
            }
          } catch {
            // ignore — placeholder is fine
          }
        }
      } catch (err) {
        console.error('Failed to load product for edit:', err)
      }
    }

    loadProduct()
    return () => { cancelled = true }
  }, [editProductId, editDataLoaded, form, categories])

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'costItems',
  })

  // NO useWatch at parent level — prevents re-render storms on every keystroke.
  // Each step component uses its own useWatch for the data it needs.

  const handleNext = useCallback(async () => {
    const stepFields = STEP_FIELDS[currentStep as keyof typeof STEP_FIELDS]
    if (stepFields) {
      const isValid = await form.trigger(
        stepFields as unknown as (keyof HppCalculateFormData)[],
      )
      if (!isValid) return
    }
    if (currentStep < 4) setCurrentStep((s) => s + 1)
  }, [currentStep, form])

  const handleBack = useCallback(() => {
    if (currentStep > 1) setCurrentStep((s) => s - 1)
  }, [currentStep])

  const handleSaveCalculation = useCallback(async () => {
    const data = form.getValues()
    setSaving(true)
    try {
      const costItems = data.costItems
      let hasProductCostItems = false

      // JUR-85 — fail-fast validation BEFORE any destructive write.
      // Resolve every row's unit + source FIRST, then create suppliers /
      // materials, THEN build the full BOM payload, and only THEN call
      // the atomic replaceProductMaterials. If anything throws in this
      // pre-flight, the DB is untouched and the recipe stays intact.
      //
      // Step 1: resolve unit IDs for every row. resolveUnitId throws
      // a friendly Indonesian error if a unit isn't in the master list
      // — historically this would fire AFTER clearProductMaterials had
      // already wiped the recipe (JUR-85).
      const resolvedUnitIds: string[] = []
      for (let i = 0; i < costItems.length; i++) {
        const item = costItems[i]!
        resolvedUnitIds.push(resolveUnitId(item.unit))
      }

      // Step 2: resolve material IDs — pick existing or auto-create.
      // Still pre-destructive: createMaterial inserts a new row but
      // that's additive (won't touch the recipe being edited).
      const resolvedMaterialIds: Record<number, string> = {}
      for (let i = 0; i < costItems.length; i++) {
        const item = costItems[i]!
        if (item.productId) {
          hasProductCostItems = true
          continue
        }
        if (item.materialId) {
          resolvedMaterialIds[i] = item.materialId
          continue
        }
        // Auto-create supplier if name provided
        let supplierId: string | undefined
        if (item.supplier.trim()) {
          const supplier = await findOrCreateSupplier({
            data: { name: item.supplier.trim() },
          })
          supplierId = supplier.id
        }
        // Auto-create material
        const ppu = String(parseFloat(item.pricePerUnit) || 0)
        const material = await createMaterial({
          data: {
            name: item.name,
            brand: item.brand || undefined,
            unitId: resolvedUnitIds[i]!,
            purchasePrice: ppu,
            purchaseQty: '1',
            supplierId: supplierId || '',
          },
        })
        resolvedMaterialIds[i] = material.id
      }

      const category = data.category

      // Create or update product. For edits this is a metadata-only
      // change (name/sku/price/etc) — BOM rewrite happens atomically
      // below via replaceProductMaterials.
      let productId: string
      if (isEditMode && editProductId) {
        await updateProduct({
          data: {
            id: editProductId,
            name: data.productName,
            sku: data.sku || undefined,
            category,
            sellingPrice: String(parseFloat(data.sellingPrice) || 0),
            productionQty: data.productionQty,
            productionUnit: data.productionUnit,
            notes: data.notes || undefined,
          },
        })
        productId = editProductId
      } else {
        const product = await createProduct({
          data: {
            name: data.productName,
            sku: data.sku || undefined,
            category,
            sellingPrice: String(parseFloat(data.sellingPrice) || 0),
            productionQty: data.productionQty,
            productionUnit: data.productionUnit,
            notes: data.notes || undefined,
          },
        })
        productId = product.id
      }

      // Step 3: build the BOM payload + write it atomically. The new
      // replaceProductMaterials server fn wraps DELETE-existing +
      // INSERT-new in a single transaction, so the recipe is never
      // left empty if any insert fails. Material-sourced rows get
      // materialId set; nested sub-product rows get sourceProductId
      // — the DB CHECK enforces exactly one is non-null.
      const items = costItems.map((item, i) => {
        if (item.productId) {
          return {
            sourceProductId: item.productId,
            materialId: null as string | null,
            quantity: String(parseFloat(item.quantity) || 0),
            unitId: resolvedUnitIds[i]!,
            // Sub-products don't participate in prep-phase split yet;
            // default 'prep' keeps them flowing through the existing
            // BOM walk.
            addAt: 'prep' as const,
          }
        }
        return {
          materialId: resolvedMaterialIds[i]!,
          sourceProductId: null as string | null,
          quantity: String(parseFloat(item.quantity) || 0),
          unitId: resolvedUnitIds[i]!,
          addAt: (item.addAt ?? 'prep') as 'prep' | 'finish',
        }
      })
      await replaceProductMaterials({ data: { productId, items } })

      if (hasProductCostItems) {
        // Calculate full HPP including product-based cost items
        const totalHpp = costItems.reduce(
          (sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.pricePerUnit) || 0),
          0,
        )
        await setProductHpp({ data: { productId, hpp: totalHpp } })
      } else {
        // Pure material-based — server calculation from BOM is accurate
        await calculateProductHpp({ data: { productId } })
      }

      // Photo upload (Item 3) — optional, runs only when the user
      // picked a fresh image this session. Failure shows a non-fatal
      // toast: the HPP itself saved fine, the photo just didn't stick.
      if (photoChanged && photoDataUrl) {
        try {
          await uploadHppProductPhotoFn({
            data: { productId, photoDataUrl },
          })
        } catch (photoErr) {
          const msg =
            photoErr instanceof Error
              ? photoErr.message
              : 'Gagal mengunggah foto produk'
          toast({
            title: 'Foto gagal diunggah',
            description: `${msg} — perhitungan HPP tetap tersimpan.`,
            variant: 'error',
          })
        }
      }

      // Invalidate caches across every surface that consumes these axes
      // (POS masters, inventory items list, PO pickers, etc.).
      invalidateTenantMaterials(queryClient)
      invalidateTenantProducts(queryClient)

      // Navigate to HPP list
      navigate({ to: '/hpp' })
    } catch (err) {
      // Surface the error — until now the catch silently console.errored,
      // so the user clicked Simpan Perubahan and saw "nothing happens"
      // when actually a server fn (most often resolveUnitId mismatch
      // or createMaterial validation) was throwing.
      const message = err instanceof Error ? err.message : 'Gagal menyimpan perhitungan HPP'
      console.error('Save calculation error:', err)
      toast({
        title: 'Gagal menyimpan',
        description: message,
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }, [form, queryClient, navigate, toast, isEditMode, editProductId, resolveUnitId, photoChanged, photoDataUrl])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('calc.pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('calc.pageSubtitle')}
        </p>
      </div>

      {/* Stepper Header */}
      <StepperHeader currentStep={currentStep} isEditMode={isEditMode} onStepClick={isEditMode ? setCurrentStep : undefined} />

      {/* Step Content */}
      {(currentStep === 1 || currentStep === 2) && (
        <Card>
          {currentStep === 1 && <StepInfoProduk form={form} categories={categories} units={units} onCategoryCreated={refetchCategories} />}
          {currentStep === 2 && (
            <StepKomponenBiaya
              form={form}
              fields={fields}
              units={units}
              materials={materialOptions}
              products={productOptions}
              suppliers={supplierOptions}
              suppliersRaw={suppliersRaw}
              onAddRow={() => append(MATERIAL_DEFAULTS)}
              onRemove={remove}
              resolveUnitId={resolveUnitId}
              onMaterialCreated={async () => {
                await Promise.all([refetchMaterials(), refetchSuppliers()])
              }}
            />
          )}

          {/* Navigation Footer */}
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4 dark:border-gray-700">
            <div>
              {currentStep > 1 && (
                <Button variant="ghost" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4" />
                  {t('calc.nav.back')}
                </Button>
              )}
            </div>
            <Button variant="brand" onClick={handleNext}>
              {t('calc.nav.continue')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {currentStep === 3 && (
        <StepHargaJual
          form={form}
          onBack={handleBack}
          onNext={handleNext}
        />
      )}

      {currentStep === 4 && (
        <StepRingkasan
          form={form}
          categories={categories}
          units={units}
          onBack={handleBack}
          onSave={handleSaveCalculation}
          saving={saving}
          photoValue={photoDataUrl}
          onPhotoChange={(next) => {
            setPhotoDataUrl(next)
            setPhotoChanged(true)
          }}
        />
      )}
    </div>
  )
}

// ─── Stepper Header ───────────────────────────────────

function StepperHeader({
  currentStep,
  isEditMode,
  onStepClick,
}: {
  currentStep: number
  isEditMode?: boolean
  onStepClick?: (step: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:shadow-gray-900/20 sm:p-6">
      <div className="flex items-center">
        {STEPS.map((step, idx) => {
          const isLast = idx === STEPS.length - 1
          const isClickable = isEditMode && onStepClick
          return (
            <div
              key={step.number}
              className={cn('flex items-center', !isLast && 'flex-1')}
            >
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(step.number)}
                className={cn(
                  'flex flex-col items-center gap-2',
                  isClickable && 'cursor-pointer',
                )}
              >
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-all duration-200',
                    currentStep > step.number
                      ? 'bg-brand-600 text-white'
                      : currentStep === step.number
                        ? 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-900'
                        : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
                    isClickable && step.number !== currentStep && 'hover:ring-2 hover:ring-brand-200 dark:hover:ring-brand-800',
                  )}
                >
                  {currentStep > step.number ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={cn(
                    'hidden text-center text-xs font-medium sm:block',
                    currentStep >= step.number
                      ? 'text-brand-700 font-semibold dark:text-brand-300'
                      : 'text-gray-400 dark:text-gray-500',
                  )}
                >
                  {t(step.labelKey)}
                </span>
              </button>
              {!isLast && (
                <div className="mx-2 h-0.5 flex-1 sm:mx-4">
                  <div
                    className={cn(
                      'h-full rounded-full transition-colors duration-200',
                      currentStep > step.number
                        ? 'bg-brand-500'
                        : 'bg-gray-200 dark:bg-gray-700',
                    )}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step 1: Info Produk ──────────────────────────────

function StepInfoProduk({
  form,
  categories,
  units,
  onCategoryCreated,
}: {
  form: UseFormReturn<HppCalculateFormData>
  categories: MasterOption[]
  units: MasterOption[]
  onCategoryCreated: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const {
    register,
    formState: { errors },
    setValue,
  } = form

  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addCategoryLoading, setAddCategoryLoading] = useState(false)
  const [addCategoryError, setAddCategoryError] = useState('')

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      setAddCategoryError(t('validation.categoryRequired'))
      return
    }
    setAddCategoryError('')
    setAddCategoryLoading(true)
    try {
      await createTenantCategory({ data: { name: trimmed } })
      invalidateTenantCategories(queryClient)
      await onCategoryCreated()
      setValue('category', trimmed)
      setNewCategoryName('')
      setShowAddCategory(false)
    } catch {
      setAddCategoryError(t('validation.categoryRequired'))
    } finally {
      setAddCategoryLoading(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>{t('calc.step1.title')}</CardTitle>
        <CardDescription>
          {t('calc.step1.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label={t('calc.step1.productName')}
                placeholder={t('calc.step1.productNamePlaceholder')}
                required
                error={errors.productName?.message ? t(errors.productName.message) : undefined}
                {...register('productName')}
              />
              <Input
                label={t('calc.step1.sku')}
                placeholder={t('calc.step1.skuPlaceholder')}
                {...register('sku')}
              />
            </div>
            <div>
              <Select
                label={t('calc.step1.category')}
                options={categories}
                placeholder={t('calc.step1.categoryPlaceholder')}
                error={errors.category?.message ? t(errors.category.message) : undefined}
                {...register('category')}
              />
              <button
                type="button"
                onClick={() => setShowAddCategory(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                <Plus className="h-3 w-3" />
                {t('calc.step1.addCategory')}
              </button>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('calc.step1.productionTitle')}
              </p>
              <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
                {t('calc.step1.productionQtyHint')}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label={t('calc.step1.productionQty')}
                  placeholder={t('calc.step1.productionQtyPlaceholder')}
                  type="number"
                  min="0"
                  step="any"
                  required
                  error={errors.productionQty?.message ? t(errors.productionQty.message) : undefined}
                  {...register('productionQty')}
                />
                <Select
                  label={t('calc.step1.productionUnit')}
                  options={units}
                  placeholder={t('calc.step1.productionUnitPlaceholder')}
                  error={errors.productionUnit?.message ? t(errors.productionUnit.message) : undefined}
                  {...register('productionUnit')}
                />
              </div>
            </div>
            <Textarea
              label={t('calc.step1.notes')}
              placeholder={t('calc.step1.notesPlaceholder')}
              rows={3}
              {...register('notes')}
            />
          </div>

          {/* Tips Panel */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-700 dark:bg-brand-900/30">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/50">
                  <Lightbulb className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">
                    {t('calc.step1.tipsTitle')}
                  </p>
                  <ul className="mt-2 space-y-2 text-xs text-brand-700 dark:text-brand-300">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                      <span>{t('calc.step1.tip1')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                      <span>{t('calc.step1.tip2')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                      <span>{t('calc.step1.tip3')}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>

      {/* Quick-add category sheet */}
      <Sheet open={showAddCategory} onClose={() => setShowAddCategory(false)}>
        <SheetHeader onClose={() => setShowAddCategory(false)}>
          <SheetTitle>{t('categories.sheetCreateTitle')}</SheetTitle>
          <SheetDescription>{t('categories.sheetCreateDesc')}</SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleAddCategory}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <Input
              label={t('categories.labelName')}
              placeholder={t('categories.placeholderName')}
              value={newCategoryName}
              onChange={(e) => {
                setNewCategoryName(e.target.value)
                if (addCategoryError) setAddCategoryError('')
              }}
              error={addCategoryError}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
            <Button type="button" variant="ghost" onClick={() => setShowAddCategory(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="brand" loading={addCategoryLoading}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  )
}

// ─── Step 2: Komponen Biaya ──────────────────────────

interface StepKomponenBiayaProps {
  form: UseFormReturn<HppCalculateFormData>
  fields: { id: string }[]
  units: MasterOption[]
  materials: MaterialOption[]
  products: ProductOption[]
  suppliers: SupplierOption[]
  suppliersRaw: { id: string; name: string }[]
  onAddRow: () => void
  onRemove: (index: number) => void
  onMaterialCreated: () => Promise<void>
  /** JUR-14: form keeps unit as text; server expects unitId. */
  resolveUnitId: (unitText: string) => string
}

function StepKomponenBiaya({
  form,
  fields,
  units,
  materials,
  products,
  suppliers,
  suppliersRaw,
  onAddRow,
  onRemove,
  onMaterialCreated,
  resolveUnitId,
}: StepKomponenBiayaProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errors = form.formState.errors
  const [createMaterialForIndex, setCreateMaterialForIndex] = useState<number | null>(null)
  const [createMaterialLoading, setCreateMaterialLoading] = useState(false)

  async function handleCreateMaterial(data: MaterialFormData) {
    setCreateMaterialLoading(true)
    try {
      let supplierId = data.supplierId

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

      // JUR-14: form keeps `unit` as text (data.unit), but createMaterial
      // now expects unitId. Translate via the master units cache.
      const material = await createMaterial({
        data: {
          name: data.name,
          brand: data.brand,
          unitId: resolveUnitId(data.unit),
          purchasePrice: data.purchasePrice,
          purchaseQty: data.purchaseQty,
          supplierId,
          notes: data.notes,
        },
      })

      // Inline create — invalidate cross-surface caches so POS / inventory
      // / PO pickers see the new material + supplier without a refresh.
      invalidateTenantMaterials(queryClient)
      invalidateTenantSuppliers(queryClient)

      await onMaterialCreated()

      // Auto-fill the row that triggered the sheet (guard against deleted rows)
      if (createMaterialForIndex !== null && createMaterialForIndex < fields.length) {
        const idx = createMaterialForIndex
        const supplierName = suppliersRaw.find((s) => s.id === (supplierId || ''))?.name
          || data.supplierName || ''
        form.setValue(`costItems.${idx}.name`, material.name)
        form.setValue(`costItems.${idx}.materialId`, material.id)
        form.setValue(`costItems.${idx}.productId`, '')
        form.setValue(`costItems.${idx}.brand`, material.brand || '')
        form.setValue(`costItems.${idx}.supplier`, supplierName)
        // Server returns unit text via the join (`material.unit`), so
        // we can write it back to the form unchanged.
        form.setValue(`costItems.${idx}.unit`, material.unit)
        form.setValue(`costItems.${idx}.pricePerUnit`, material.pricePerUnit)
      }

      setCreateMaterialForIndex(null)
    } catch {
      // error handling
    } finally {
      setCreateMaterialLoading(false)
    }
  }

  return (
    <>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t('calc.step2.title')}</CardTitle>
            <CardDescription>
              {t('calc.step2.description')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Array-level error (min 1 item) */}
        {errors.costItems?.root?.message && (
          <p className="mb-4 text-sm text-danger-500">
            {t(errors.costItems.root.message)}
          </p>
        )}
        {typeof errors.costItems?.message === 'string' && (
          <p className="mb-4 text-sm text-danger-500">
            {t(errors.costItems.message)}
          </p>
        )}

        {fields.length === 0 ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16 text-center dark:border-gray-600 lg:col-span-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                <ClipboardList className="h-8 w-8 text-gray-300 dark:text-gray-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                {t('calc.step2.emptyTitle')}
              </p>
              <p className="mt-1 max-w-xs text-xs text-gray-400 dark:text-gray-500">
                {t('calc.step2.emptyDescription')}
              </p>
              <Button
                variant="brand"
                size="sm"
                className="mt-4"
                onClick={onAddRow}
              >
                <Plus className="h-4 w-4" />
                {t('calc.step2.addButton')}
              </Button>
            </div>
            <TipsPanel layout="vertical" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Desktop Table */}
            <div className="hidden lg:block">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-16 z-10">
                    <tr className="border-b border-gray-200 bg-gray-50 text-left dark:border-gray-700 dark:bg-gray-900">
                      <th className="rounded-tl-xl px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colItem')}
                      </th>
                      <th className="w-[130px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colBrand')}
                      </th>
                      <th className="w-[130px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colSupplier')}
                      </th>
                      <th className="w-[90px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colQty')}
                      </th>
                      <th className="w-[120px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colUnit')}
                      </th>
                      <th className="w-[140px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colPrice')}
                      </th>
                      <th className="w-[130px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                        {t('calc.step2.colSubtotal')}
                      </th>
                      <th
                        className="w-[130px] px-3 py-2.5 font-medium text-gray-500 dark:text-gray-400"
                        title="Kapan bahan ini dipotong dari stok: saat prep batch atau saat penjualan"
                      >
                        Tahap
                      </th>
                      <th className="w-[48px] rounded-tr-xl px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => (
                      <CostItemDesktopRow
                        key={field.id}
                        index={index}
                        form={form}
                        units={units}
                        materials={materials}
                        products={products}
                        suppliers={suppliers}
                        onRemove={() => onRemove(index)}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => setCreateMaterialForIndex(fields.length - 1)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    <Plus className="h-3 w-3" />
                    {t('calc.step2.addNewMaterial')}
                  </button>
                  <Button variant="brand" size="sm" onClick={onAddRow}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('calc.step2.addRow')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Mobile Cards */}
            <div className="space-y-3 lg:hidden">
              {fields.map((field, index) => (
                <CostItemMobileCard
                  key={field.id}
                  index={index}
                  form={form}
                  units={units}
                  materials={materials}
                  products={products}
                  suppliers={suppliers}
                  onRemove={() => onRemove(index)}
                />
              ))}
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCreateMaterialForIndex(fields.length - 1)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  <Plus className="h-3 w-3" />
                  {t('calc.step2.addNewMaterial')}
                </button>
                <Button variant="brand" size="sm" onClick={onAddRow}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('calc.step2.addRow')}
                </Button>
              </div>
            </div>

            {/* Total Footer — isolated watcher to avoid parent re-renders */}
            <TotalCostFooter control={form.control} />

            <TipsPanel layout="horizontal" />
          </div>
        )}
      </CardContent>

      {/* Create material sheet */}
      <Sheet open={createMaterialForIndex !== null} onClose={() => setCreateMaterialForIndex(null)}>
        <SheetHeader onClose={() => setCreateMaterialForIndex(null)}>
          <SheetTitle>{t('suppliers.sheetCreateMaterialTitle')}</SheetTitle>
          <SheetDescription>{t('suppliers.sheetCreateMaterialDesc')}</SheetDescription>
        </SheetHeader>
        <MaterialForm
          onSubmit={handleCreateMaterial}
          onCancel={() => setCreateMaterialForIndex(null)}
          loading={createMaterialLoading}
          suppliers={suppliersRaw}
        />
      </Sheet>
    </>
  )
}

// ─── Tips Panel ─────────────────────────────────────

function TipsPanel({ layout }: { layout: 'vertical' | 'horizontal' }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-700 dark:bg-brand-900/30">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/50">
          <Lightbulb className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">
            {t('calc.step2.tipsTitle')}
          </p>
          <ul
            className={cn(
              'mt-2 flex flex-col gap-2 text-xs text-brand-700 dark:text-brand-300',
              layout === 'horizontal' && 'sm:flex-row sm:gap-6',
            )}
          >
            <li className="flex items-start gap-2">
              <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span>{t('calc.step2.tip1')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span>{t('calc.step2.tip2')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span>{t('calc.step2.tip3')}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ─── Total Cost Footer (isolated watcher) ───────────

function TotalCostFooter({
  control,
}: {
  control: UseFormReturn<HppCalculateFormData>['control']
}) {
  const { t } = useTranslation()
  const costItems = useWatch({ control, name: 'costItems' })
  const totalCost = useMemo(
    () => (costItems || []).reduce((sum, item) => sum + getSubtotal(item), 0),
    [costItems],
  )

  return (
    <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-900">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
        {t('calc.step2.totalCost')}
      </span>
      <span className="text-base font-bold text-gray-900 dark:text-gray-100">
        {formatRupiah(totalCost)}
      </span>
    </div>
  )
}

// ─── Subtotal Cell (isolated watcher per row) ───────

function SubtotalCell({
  control,
  index,
}: {
  control: UseFormReturn<HppCalculateFormData>['control']
  index: number
}) {
  const item = useWatch({ control, name: `costItems.${index}` })
  const subtotal = item ? getSubtotal(item) : 0
  return (
    <span className="block text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
      {formatRupiah(subtotal)}
    </span>
  )
}

// ─── Bulk Price Helper ──────────────────────────────

// ─── Desktop Table Row ──────────────────────────────

const inlineInputClass =
  'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm focus:border-brand-300 focus:ring-1 focus:ring-brand-300 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500'

function CostItemDesktopRow({
  index,
  form,
  units,
  materials,
  products,
  suppliers,
  onRemove,
}: {
  index: number
  form: UseFormReturn<HppCalculateFormData>
  units: MasterOption[]
  materials: MaterialOption[]
  products: ProductOption[]
  suppliers: SupplierOption[]
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const { control, setValue } = form
  const materialId = useWatch({ control, name: `costItems.${index}.materialId` })
  const productId = useWatch({ control, name: `costItems.${index}.productId` })
  const isFromMaster = !!materialId || !!productId

  const handleMaterialSelect = useCallback(
    (material: MaterialOption) => {
      setValue(`costItems.${index}.materialId`, material.id)
      setValue(`costItems.${index}.productId`, '')
      setValue(`costItems.${index}.brand`, material.brand || '')
      setValue(`costItems.${index}.supplier`, material.supplierName || '')
      setValue(`costItems.${index}.unit`, material.unit)
      setValue(`costItems.${index}.pricePerUnit`, material.pricePerUnit)
    },
    [setValue, index],
  )

  const handleProductSelect = useCallback(
    (product: ProductOption) => {
      setValue(`costItems.${index}.productId`, product.id)
      setValue(`costItems.${index}.materialId`, '')
      setValue(`costItems.${index}.name`, product.name)
      setValue(`costItems.${index}.brand`, '')
      setValue(`costItems.${index}.supplier`, '')
      setValue(`costItems.${index}.unit`, product.unit)
      setValue(`costItems.${index}.pricePerUnit`, String(product.hpp))
    },
    [setValue, index],
  )

  return (
    <tr className="border-b border-gray-100 bg-white align-top dark:border-gray-700 dark:bg-gray-800">
      <td className="px-3 py-2">
        <Controller
          control={control}
          name={`costItems.${index}.name`}
          render={({ field, fieldState }) => (
            <MaterialCombobox
              value={field.value}
              onChange={(val) => {
                field.onChange(val)
                // Clear IDs when user types manually after a selection
                setValue(`costItems.${index}.materialId`, '')
                setValue(`costItems.${index}.productId`, '')
              }}
              onSelect={handleMaterialSelect}
              onSelectProduct={handleProductSelect}
              materials={materials}
              products={products}
              error={fieldState.error?.message ? t(fieldState.error.message) : undefined}
              placeholder={t('calc.step2.searchMaterialPlaceholder')}
              disableCreate
            />
          )}
        />
      </td>
      <td className="px-3 py-2">
        <Controller
          control={control}
          name={`costItems.${index}.brand`}
          render={({ field }) => (
            <input
              {...field}
              readOnly
              tabIndex={-1}
              className={cn(inlineInputClass, 'w-full cursor-default border-transparent bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400')}
              placeholder={t('calc.step2.mobileBrand')}
            />
          )}
        />
      </td>
      <td className="px-3 py-2">
        <Controller
          control={control}
          name={`costItems.${index}.supplier`}
          render={({ field }) => (
            <SupplierCombobox
              value={field.value}
              onChange={field.onChange}
              suppliers={suppliers}
              placeholder={t('calc.step2.mobileSupplier')}
              readOnly
              disableCreate
            />
          )}
        />
      </td>
      <td className="px-3 py-2">
        <Controller
          control={control}
          name={`costItems.${index}.quantity`}
          render={({ field, fieldState }) => (
            <>
              <input
                {...field}
                type="number"
                className={cn(
                  inlineInputClass,
                  'w-full',
                  fieldState.error && 'border-danger-500',
                )}
                placeholder="0"
                min="0"
              />
              {fieldState.error && (
                <p className="mt-1 text-xs text-danger-500">
                  {fieldState.error.message ? t(fieldState.error.message) : null}
                </p>
              )}
            </>
          )}
        />
      </td>
      <td className="px-3 py-2">
        <Controller
          control={control}
          name={`costItems.${index}.unit`}
          render={({ field }) => (
            isFromMaster ? (
              <input
                value={units.find((u) => u.value === field.value)?.label || field.value}
                readOnly
                tabIndex={-1}
                className={cn(inlineInputClass, 'w-full cursor-default border-transparent bg-gray-50 text-gray-500')}
              />
            ) : (
              <select
                {...field}
                className={cn(
                  inlineInputClass,
                  'w-full appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E")] bg-[length:12px] bg-[right_6px_center] bg-no-repeat pr-6',
                )}
              >
                {units.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            )
          )}
        />
      </td>
      <td className="px-3 py-2">
        <Controller
          control={control}
          name={`costItems.${index}.pricePerUnit`}
          render={({ field, fieldState }) => (
            <>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500">
                  Rp
                </span>
                <input
                  {...field}
                  type="text"
                  readOnly
                  tabIndex={-1}
                  value={formatNumberID(Number(field.value))}
                  className={cn(
                    inlineInputClass,
                    'w-full cursor-default border-transparent bg-gray-50 pl-8 text-gray-500 dark:bg-gray-900 dark:text-gray-400',
                    fieldState.error && 'border-danger-500',
                  )}
                  placeholder="0"
                />
              </div>
              {fieldState.error && (
                <p className="mt-1 text-xs text-danger-500">
                  {fieldState.error.message ? t(fieldState.error.message) : null}
                </p>
              )}
            </>
          )}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <SubtotalCell control={control} index={index} />
      </td>
      <td className="px-3 py-2 align-middle">
        <Controller
          control={control}
          name={`costItems.${index}.addAt`}
          render={({ field }) => (
            <select
              {...field}
              value={field.value ?? 'prep'}
              title="Tahap: 'Prep' dipotong saat prep batch. 'Saat dijual' dipotong per pesanan (mis. gula/susu di warung kopi)."
              className={cn(
                inlineInputClass,
                'w-full appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E")] bg-[length:12px] bg-[right_6px_center] bg-no-repeat pr-6',
              )}
            >
              <option value="prep">Prep</option>
              <option value="finish">Saat dijual</option>
            </select>
          )}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          onClick={onRemove}
          title={t('calc.step2.deleteRow')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

// ─── Mobile Card ────────────────────────────────────

function CostItemMobileCard({
  index,
  form,
  units,
  materials,
  products,
  suppliers,
  onRemove,
}: {
  index: number
  form: UseFormReturn<HppCalculateFormData>
  units: MasterOption[]
  materials: MaterialOption[]
  products: ProductOption[]
  suppliers: SupplierOption[]
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const { control, setValue } = form
  const materialId = useWatch({ control, name: `costItems.${index}.materialId` })
  const productId = useWatch({ control, name: `costItems.${index}.productId` })
  const isFromMaster = !!materialId || !!productId

  const handleMaterialSelect = useCallback(
    (material: MaterialOption) => {
      setValue(`costItems.${index}.materialId`, material.id)
      setValue(`costItems.${index}.productId`, '')
      setValue(`costItems.${index}.name`, material.name)
      setValue(`costItems.${index}.brand`, material.brand || '')
      setValue(`costItems.${index}.supplier`, material.supplierName || '')
      setValue(`costItems.${index}.unit`, material.unit)
      setValue(`costItems.${index}.pricePerUnit`, material.pricePerUnit)
    },
    [setValue, index],
  )

  const handleProductSelect = useCallback(
    (product: ProductOption) => {
      setValue(`costItems.${index}.productId`, product.id)
      setValue(`costItems.${index}.materialId`, '')
      setValue(`costItems.${index}.name`, product.name)
      setValue(`costItems.${index}.brand`, '')
      setValue(`costItems.${index}.supplier`, '')
      setValue(`costItems.${index}.unit`, product.unit)
      setValue(`costItems.${index}.pricePerUnit`, String(product.hpp))
    },
    [setValue, index],
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          <Badge className="text-xs">{t('calc.step2.mobileBadge')}</Badge>
        </div>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('calc.step2.mobileItem')}
          </label>
          <Controller
            control={control}
            name={`costItems.${index}.name`}
            render={({ field, fieldState }) => (
              <MaterialCombobox
                value={field.value}
                onChange={(val) => {
                  field.onChange(val)
                  setValue(`costItems.${index}.materialId`, '')
                  setValue(`costItems.${index}.productId`, '')
                }}
                onSelect={handleMaterialSelect}
                onSelectProduct={handleProductSelect}
                materials={materials}
                products={products}
                error={fieldState.error?.message ? t(fieldState.error.message) : undefined}
                placeholder={t('calc.step2.searchMaterialPlaceholder')}
                className="mt-1"
                disableCreate
              />
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('calc.step2.mobileBrand')}</label>
            <Controller
              control={control}
              name={`costItems.${index}.brand`}
              render={({ field }) => (
                <input
                  {...field}
                  readOnly
                  tabIndex={-1}
                  className={cn(inlineInputClass, 'mt-1 w-full cursor-default border-transparent bg-gray-50 text-gray-500 dark:bg-gray-900 dark:text-gray-400')}
                  placeholder={t('calc.step2.mobileBrand')}
                />
              )}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('calc.step2.mobileSupplier')}
            </label>
            <Controller
              control={control}
              name={`costItems.${index}.supplier`}
              render={({ field }) => (
                <SupplierCombobox
                  value={field.value}
                  onChange={field.onChange}
                  suppliers={suppliers}
                  placeholder={t('calc.step2.mobileSupplier')}
                  readOnly
                  className="mt-1"
                  disableCreate
                />
              )}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('calc.step2.mobileQty')}</label>
            <Controller
              control={control}
              name={`costItems.${index}.quantity`}
              render={({ field, fieldState }) => (
                <>
                  <input
                    {...field}
                    type="number"
                    className={cn(
                      inlineInputClass,
                      'mt-1 w-full',
                      fieldState.error && 'border-danger-500',
                    )}
                    placeholder="0"
                    min="0"
                  />
                  {fieldState.error && (
                    <p className="mt-1 text-xs text-danger-500">
                      {fieldState.error.message ? t(fieldState.error.message) : null}
                    </p>
                  )}
                </>
              )}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('calc.step2.mobileUnit')}</label>
            <Controller
              control={control}
              name={`costItems.${index}.unit`}
              render={({ field }) => (
                isFromMaster ? (
                  <input
                    value={units.find((u) => u.value === field.value)?.label || field.value}
                    readOnly
                    tabIndex={-1}
                    className={cn(inlineInputClass, 'mt-1 w-full cursor-default border-transparent bg-gray-50 text-gray-500')}
                  />
                ) : (
                  <select
                    {...field}
                    className={cn(
                      inlineInputClass,
                      'mt-1 w-full appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E")] bg-[length:12px] bg-[right_6px_center] bg-no-repeat pr-6',
                    )}
                  >
                    {units.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                )
              )}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('calc.step2.mobilePrice')}
            </label>
            <Controller
              control={control}
              name={`costItems.${index}.pricePerUnit`}
              render={({ field, fieldState }) => (
                <>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500">
                      Rp
                    </span>
                    <input
                      {...field}
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={formatNumberID(Number(field.value))}
                      className={cn(
                        inlineInputClass,
                        'w-full cursor-default border-transparent bg-gray-50 pl-8 text-gray-500 dark:bg-gray-900 dark:text-gray-400',
                        fieldState.error && 'border-danger-500',
                      )}
                      placeholder="0"
                    />
                  </div>
                  {fieldState.error && (
                    <p className="mt-1 text-xs text-danger-500">
                      {fieldState.error.message ? t(fieldState.error.message) : null}
                    </p>
                  )}
                </>
              )}
            />
          </div>
        </div>
        <MobileSubtotalRow control={control} index={index} />
      </div>
    </div>
  )
}

// ─── Mobile Subtotal Row (isolated watcher) ─────────

function MobileSubtotalRow({
  control,
  index,
}: {
  control: UseFormReturn<HppCalculateFormData>['control']
  index: number
}) {
  const { t } = useTranslation()
  const item = useWatch({ control, name: `costItems.${index}` })
  const subtotal = item ? getSubtotal(item) : 0
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900">
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('calc.step2.mobileSubtotal')}</span>
      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
        {formatRupiah(subtotal)}
      </span>
    </div>
  )
}

// ─── Step 3: Harga Jual ─────────────────────────────

const MONTHLY_FIXED_COST = 2_000_000
const DAILY_SALES_ESTIMATE = 50

interface StepHargaJualProps {
  form: UseFormReturn<HppCalculateFormData>
  onBack: () => void
  onNext: () => void
}

function StepHargaJual({
  form,
  onBack,
  onNext,
}: StepHargaJualProps) {
  const { t } = useTranslation()
  const {
    register,
    formState: { errors },
  } = form

  const costItems = useWatch({ control: form.control, name: 'costItems' })
  const targetMargin = useWatch({
    control: form.control,
    name: 'targetMargin',
  })
  const sellingPrice = useWatch({
    control: form.control,
    name: 'sellingPrice',
  })
  const competitors = useWatch({
    control: form.control,
    name: 'competitors',
  })

  const totalCost = useMemo(
    () => (costItems || []).reduce((sum, item) => sum + getSubtotal(item), 0),
    [costItems],
  )

  const suggestedPrice = useMemo(() => {
    const m = parseFloat(targetMargin) || 0
    if (m >= 100 || m <= 0 || totalCost === 0) return 0
    return totalCost / (1 - m / 100)
  }, [totalCost, targetMargin])

  // Auto-fill selling price from suggested when empty
  useEffect(() => {
    if (sellingPrice === '' && suggestedPrice > 0) {
      form.setValue(
        'sellingPrice',
        String(Math.ceil(suggestedPrice / 100) * 100),
      )
    }
  }, [suggestedPrice, sellingPrice, form])

  const margin = parseFloat(targetMargin) || 0
  const finalPrice = parseFloat(sellingPrice) || 0
  const profit = finalPrice > 0 && totalCost > 0 ? finalPrice - totalCost : 0
  const actualMarginPercent =
    finalPrice > 0 ? (profit / finalPrice) * 100 : 0
  const gaugePercent =
    margin > 0 ? Math.min(100, (actualMarginPercent / margin) * 100) : 0
  const isMarginMet = actualMarginPercent >= margin && margin > 0
  const bepUnits = profit > 0 ? Math.ceil(MONTHLY_FIXED_COST / profit) : 0
  const bepProgress =
    bepUnits > 0
      ? Math.min(100, (DAILY_SALES_ESTIMATE / bepUnits) * 100)
      : 0

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/50">
                  <DollarSign className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                </div>
                <CardTitle>{t('calc.step3.title')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-5 py-4 dark:border-brand-700 dark:bg-brand-900/30">
                <div>
                  <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                    {t('calc.step3.hppLabel')}
                  </p>
                  <p className="mt-0.5 text-xs text-brand-500 dark:text-brand-400">
                    {t('calc.step3.hppSubLabel')}
                  </p>
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatRupiah(totalCost)}
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-5">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('calc.step3.targetMarginLabel')}
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        type="number"
                        className={cn(
                          inlineInputClass,
                          'h-10 w-full pr-10',
                          errors.targetMargin && 'border-danger-500',
                        )}
                        min="0"
                        max="99"
                        {...register('targetMargin')}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-gray-500">
                        %
                      </span>
                    </div>
                    {errors.targetMargin ? (
                      <p className="mt-1.5 text-xs text-danger-500">
                        {t(errors.targetMargin.message!)}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        {t('calc.step3.targetMarginHint')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('calc.step3.suggestedPriceLabel')}
                    </label>
                    <div className="relative mt-1.5">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-gray-500">
                        Rp
                      </span>
                      <input
                        type="text"
                        readOnly
                        className={cn(
                          inlineInputClass,
                          'h-10 w-full cursor-default bg-gray-50 pl-9 text-gray-600 dark:bg-gray-900 dark:text-gray-400',
                        )}
                        value={
                          suggestedPrice > 0
                            ? formatNumberID(Math.floor(suggestedPrice))
                            : '0'
                        }
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      {t('calc.step3.suggestedPriceHint')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col rounded-xl border-2 border-brand-300 bg-white p-5 dark:bg-gray-800">
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {t('calc.step3.finalPriceLabel')}
                  </p>
                  <div className="relative mt-3">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-medium text-gray-400 dark:text-gray-500">
                      Rp
                    </span>
                    <input
                      type="number"
                      className={cn(
                        'h-12 w-full rounded-lg border border-brand-300 bg-white pl-10 pr-3 text-xl font-bold text-gray-900',
                        'focus:border-brand-400 focus:ring-2 focus:ring-brand-200 focus:outline-none',
                        'dark:bg-gray-800 dark:text-gray-100',
                        errors.sellingPrice && 'border-danger-500',
                      )}
                      placeholder="0"
                      min="0"
                      {...register('sellingPrice')}
                    />
                  </div>
                  {errors.sellingPrice ? (
                    <p className="mt-2 text-xs text-danger-500">
                      {t(errors.sellingPrice.message!)}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {t('calc.step3.finalPriceHint')}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-700">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t('calc.step3.profitPerUnit')}
                    </span>
                    <span
                      className={cn(
                        'text-sm font-bold',
                        profit > 0
                          ? 'text-brand-600'
                          : profit < 0
                            ? 'text-red-500'
                            : 'text-gray-400',
                      )}
                    >
                      {profit >= 0 ? '+ ' : '- '}
                      {formatRupiah(Math.abs(profit))}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                  <BarChart3 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </div>
                <CardTitle>{t('calc.step3.competitorTitle')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                {t('calc.step3.competitorDescription')}
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {(['a', 'b', 'c'] as const).map((key, i) => {
                  const compPrice =
                    parseFloat(competitors?.[key] || '') || 0
                  const hasBoth = compPrice > 0 && finalPrice > 0

                  let compLabel = ''
                  let compColor = ''
                  let CompIcon: typeof ArrowDown | null = null

                  if (hasBoth && finalPrice < compPrice) {
                    const pct = Math.round(
                      ((compPrice - finalPrice) / compPrice) * 100,
                    )
                    compLabel = t('calc.step3.cheaperBy', { pct })
                    compColor = 'text-brand-600'
                    CompIcon = ArrowDown
                  } else if (hasBoth && finalPrice > compPrice) {
                    const pct = Math.round(
                      ((finalPrice - compPrice) / compPrice) * 100,
                    )
                    compLabel = t('calc.step3.pricierBy', { pct })
                    compColor = 'text-red-500'
                    CompIcon = ArrowUp
                  }

                  return (
                    <div key={key}>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('calc.step3.competitorLabel', { letter: String.fromCharCode(65 + i) })}
                      </label>
                      <div className="relative mt-1.5">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-gray-500">
                          Rp
                        </span>
                        <input
                          type="number"
                          className={cn(
                            inlineInputClass,
                            'h-10 w-full pl-9',
                          )}
                          placeholder="0"
                          min="0"
                          {...register(`competitors.${key}`)}
                        />
                      </div>
                      {compLabel && CompIcon && (
                        <p
                          className={cn(
                            'mt-1.5 flex items-center gap-1 text-xs font-medium',
                            compColor,
                          )}
                        >
                          <CompIcon className="h-3 w-3" />
                          {compLabel}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-6">
            <Card>
              <CardContent className="pt-6">
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t('calc.step3.profitSimTitle')}
                </p>
                <ProfitGauge percentage={gaugePercent} />
                <p className="text-center text-sm font-medium text-gray-700 dark:text-gray-300">
                  {isMarginMet
                    ? t('calc.step3.marginMet')
                    : t('calc.step3.marginNotMet')}
                </p>

                <div
                  className={cn(
                    'mt-4 rounded-xl border p-4',
                    profit > 0
                      ? 'border-brand-200 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30'
                      : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30',
                  )}
                >
                  <Badge variant={profit > 0 ? 'success' : 'danger'}>
                    {t('calc.step3.profitStatus')}
                  </Badge>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                    {/* JUR-130: Trans interprets <strong> in the i18n
                        string instead of rendering it as literal text. */}
                    <Trans
                      i18nKey="calc.step3.profitDesc"
                      values={{ amount: formatRupiah(profit) }}
                      components={{ strong: <strong /> }}
                    />
                  </p>
                </div>

                <div className="mt-6">
                  <p className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                    {t('calc.step3.bepTitle')}
                  </p>
                  {bepUnits > 0 ? (
                    <>
                      <p className="mt-2 text-sm font-semibold text-brand-600 dark:text-brand-400">
                        {t('calc.step3.bepSalesLabel', { count: DAILY_SALES_ESTIMATE })}
                      </p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900/50">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all"
                          style={{ width: `${bepProgress}%` }}
                        />
                      </div>
                      <p className="mt-2.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                        {/* JUR-130 + JUR-137: Trans interprets <strong>
                            so it renders bold; bepUnits goes through
                            formatRupiah-style id-ID formatting via
                            Intl.NumberFormat to avoid SSR/client drift
                            from raw toLocaleString. */}
                        <Trans
                          i18nKey="calc.step3.bepDesc"
                          values={{
                            fixedCost: formatRupiah(MONTHLY_FIXED_COST),
                            units: new Intl.NumberFormat('id-ID').format(bepUnits),
                          }}
                          components={{ strong: <strong /> }}
                        />
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      {t('calc.step3.bepEmpty')}
                    </p>
                  )}
                </div>

                <div className="mt-6">
                  <p className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
                    {t('calc.step3.summaryTitle')}
                  </p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-gray-600 dark:text-gray-400">{t('calc.step3.summaryHpp')}</dt>
                      <dd className="font-medium text-gray-900 dark:text-gray-100">
                        {formatRupiah(totalCost)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-gray-600 dark:text-gray-400">{t('calc.step3.summaryMargin')}</dt>
                      <dd className="font-medium text-brand-600 dark:text-brand-400">
                        {formatRupiah(profit)} (
                        {Math.round(actualMarginPercent)}%)
                      </dd>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-200 pt-2 dark:border-gray-700">
                      <dt className="font-bold text-gray-900 dark:text-gray-100">{t('calc.step3.summarySellingPrice')}</dt>
                      <dd className="font-bold text-brand-600 dark:text-brand-400">
                        {formatRupiah(finalPrice)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                  <Download className="h-4 w-4" />
                  {t('calc.step3.saveDraft')}
                </button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:shadow-gray-900/20">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t('calc.nav.back')}
        </Button>
        <Button variant="brand" onClick={onNext}>
          {t('calc.nav.continue')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  )
}

// ─── Profit Gauge ───────────────────────────────────

function ProfitGauge({ percentage }: { percentage: number }) {
  const pct = Math.min(100, Math.max(0, percentage))
  const radius = 80
  const arcLength = Math.PI * radius
  const fillLength = (pct / 100) * arcLength
  const color =
    pct >= 100 ? '#399d68' : pct >= 50 ? '#d4881f' : '#c94840'

  return (
    <div className="flex justify-center py-4">
      <svg viewBox="0 0 200 115" className="w-40">
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="#e2e5ec"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${fillLength} ${arcLength}`}
          />
        )}
      </svg>
    </div>
  )
}

// ─── Step 4: Ringkasan ──────────────────────────────

interface StepRingkasanProps {
  form: UseFormReturn<HppCalculateFormData>
  categories: MasterOption[]
  units: MasterOption[]
  onBack: () => void
  onSave: () => void
  saving: boolean
  /** Optional product photo. Same data-URL/signed-URL contract as
   *  PhotoUploadField — parent handles upload after save succeeds. */
  photoValue: string | null
  onPhotoChange: (next: string | null) => void
}

function StepRingkasan({
  form,
  categories,
  units,
  onBack,
  onSave,
  saving,
  photoValue,
  onPhotoChange,
}: StepRingkasanProps) {
  const { t } = useTranslation()
  const values = form.getValues()
  const costItems = useWatch({ control: form.control, name: 'costItems' }) || []
  const totalCost = useMemo(
    () => costItems.reduce((sum, item) => sum + getSubtotal(item), 0),
    [costItems],
  )
  const finalPrice = parseFloat(values.sellingPrice) || 0
  const profit = finalPrice > 0 && totalCost > 0 ? finalPrice - totalCost : 0
  const margin = parseFloat(values.targetMargin) || 0

  const categoryDisplay = values.category || '—'

  const dateStr = formatDate(new Date(), 'd MMMM yyyy')

  const activeCompetitors = (['a', 'b', 'c'] as const)
    .map((key, i) => ({
      key,
      label: t('calc.step3.competitorLabel', { letter: String.fromCharCode(65 + i) }),
      price: parseFloat(values.competitors[key]) || 0,
    }))
    .filter((c) => c.price > 0)

  return (
    <>
      <Card>
        <CardContent className="flex items-start justify-between py-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t('calc.step4.reviewTitle', { name: values.productName || t('calc.step4.reviewDefaultName') })}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {t('calc.step4.createdOn', { date: dateStr })}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5">
            <ListChecks className="h-3.5 w-3.5" />
            DRAFT
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                <Package className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              </div>
              <CardTitle>{t('calc.step4.infoProdukTitle')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {/* Item 3 UI/UX review — optional product photo. Hidden
                label keeps the "Info Produk" card tidy; the widget
                renders its own preview + actions. */}
            <div className="mb-5">
              <p className="mb-2 text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                {t('calc.step4.labelPhoto')}
              </p>
              <PhotoUploadField
                value={photoValue}
                onChange={onPhotoChange}
              />
            </div>
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                  {t('calc.step4.labelProductName')}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {values.productName || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                  {t('calc.step4.labelCategory')}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {categoryDisplay}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                  {t('calc.step4.labelProductionOutput')}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {values.productionQty} {units.find((u) => u.value === values.productionUnit)?.label || values.productionUnit}
                </dd>
              </div>
              {values.sku && (
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                    {t('calc.step4.labelSku')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {values.sku}
                  </dd>
                </div>
              )}
              {values.notes && (
                <div>
                  <dt className="text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                    {t('calc.step4.labelDescription')}
                  </dt>
                  <dd className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                    {values.notes}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/50">
                  <DollarSign className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                </div>
                <CardTitle>{t('calc.step4.financialTitle')}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('calc.step4.statTotalHpp')}</p>
                  <p className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatRupiah(totalCost)}
                  </p>
                </div>
                <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 dark:border-brand-700 dark:bg-brand-900/30">
                  <p className="text-xs text-brand-600 dark:text-brand-400">{t('calc.step4.statTargetMargin')}</p>
                  <p className="mt-1 text-lg font-bold text-brand-600 dark:text-brand-400">
                    {Math.round(margin)}%
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('calc.step4.statProfitUnit')}</p>
                  <p
                    className={cn(
                      'mt-1 text-lg font-bold',
                      profit >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-red-500 dark:text-red-400',
                    )}
                  >
                    {profit >= 0 ? '+ ' : ''}
                    {formatRupiah(profit)}
                  </p>
                </div>
                <div className="rounded-xl border-2 border-brand-300 px-4 py-3">
                  <p className="text-xs text-brand-600 dark:text-brand-400">{t('calc.step4.statFinalPrice')}</p>
                  <p className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatRupiah(finalPrice)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {activeCompetitors.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                    <BarChart3 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  </div>
                  <CardTitle>{t('calc.step4.competitorTitle')}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    'grid gap-4',
                    activeCompetitors.length === 1
                      ? 'grid-cols-1'
                      : activeCompetitors.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-3',
                  )}
                >
                  {activeCompetitors.map((comp) => {
                    let compLabel = ''
                    let compColor = ''
                    let CompIcon: typeof ArrowDown | null = null

                    if (finalPrice < comp.price) {
                      const pct = Math.round(
                        ((comp.price - finalPrice) / comp.price) * 100,
                      )
                      compLabel = t('calc.step4.cheaperBy', { pct })
                      compColor = 'text-brand-600'
                      CompIcon = ArrowDown
                    } else if (finalPrice > comp.price) {
                      const pct = Math.round(
                        ((finalPrice - comp.price) / comp.price) * 100,
                      )
                      compLabel = t('calc.step4.pricierBy', { pct })
                      compColor = 'text-red-500'
                      CompIcon = ArrowUp
                    }

                    return (
                      <div
                        key={comp.key}
                        className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-700"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {comp.label}
                          </p>
                          {compLabel && CompIcon && (
                            <p
                              className={cn(
                                'mt-0.5 flex items-center gap-1 text-xs font-medium',
                                compColor,
                              )}
                            >
                              <CompIcon className="h-3 w-3" />
                              {compLabel}
                            </p>
                          )}
                        </div>
                        <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                          {formatRupiah(comp.price)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {costItems.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-100 dark:bg-accent-900/30">
                <ClipboardList className="h-4 w-4 text-accent-700 dark:text-accent-400" />
              </div>
              <CardTitle>{t('calc.step4.costBreakdownTitle')}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                    <th className="pb-3 pr-4 text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                      {t('calc.step4.colItem')}
                    </th>
                    <th className="pb-3 pr-4 text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                      {t('calc.step4.colSupplier')}
                    </th>
                    <th className="pb-3 pr-4 text-center text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                      {t('calc.step4.colQty')}
                    </th>
                    <th className="pb-3 pr-4 text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                      {t('calc.step4.colUnit')}
                    </th>
                    <th className="pb-3 pr-4 text-right text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                      {t('calc.step4.colPrice')}
                    </th>
                    <th className="pb-3 text-right text-xs font-semibold tracking-wide text-gray-400 dark:text-gray-500">
                      {t('calc.step4.colSubtotal')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {costItems.map((item, idx) => {
                    const subtotal = getSubtotal(item)
                    return (
                      <tr key={idx} className="border-b border-gray-100 dark:border-gray-700">
                        <td className="py-3.5 pr-4 font-medium text-gray-900 dark:text-gray-100">
                          {item.name || '—'}
                        </td>
                        <td className="py-3.5 pr-4 text-gray-500 dark:text-gray-400">
                          {item.supplier || '—'}
                        </td>
                        <td className="py-3.5 pr-4 text-center text-gray-900 dark:text-gray-100">
                          {item.quantity || '0'}
                        </td>
                        <td className="py-3.5 pr-4 text-gray-500 dark:text-gray-400">
                          {item.unit}
                        </td>
                        <td className="py-3.5 pr-4 text-right text-gray-900 dark:text-gray-100">
                          {formatRupiahDecimal(parseFloat(item.pricePerUnit) || 0)}
                        </td>
                        <td className="py-3.5 text-right font-semibold text-brand-600 dark:text-brand-400">
                          {formatRupiah(subtotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 sm:hidden">
              {costItems.map((item, idx) => {
                const subtotal = getSubtotal(item)
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-gray-200 p-3 dark:border-gray-700"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {item.name || '—'}
                      </p>
                      <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                        {formatRupiah(subtotal)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {item.quantity} {item.unit} &times;{' '}
                      {formatRupiahDecimal(parseFloat(item.pricePerUnit) || 0)}
                      {item.supplier && ` · ${item.supplier}`}
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-end gap-4 border-t border-gray-200 pt-4 dark:border-gray-700">
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {t('calc.step4.totalHpp')}
              </span>
              <span className="text-xl font-bold text-brand-600 dark:text-brand-400">
                {formatRupiah(totalCost)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:shadow-gray-900/20">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t('calc.nav.back')}
        </Button>
        <Button variant="brand" onClick={onSave} disabled={saving}>
          {saving ? t('calc.nav.saving') : t('calc.nav.saveCalculation')}
        </Button>
      </div>
    </>
  )
}
