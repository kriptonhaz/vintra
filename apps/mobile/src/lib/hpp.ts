/**
 * HPP API hooks. Mirrors the web's HPP module — wraps the server fns
 * exposed via /api/mobile/<fn> so the mobile HPP dashboard + recipe
 * wizard call the same backend the web does.
 *
 * Numbers come back from the server as numeric strings (Drizzle's
 * `numeric()` type) — the hooks keep them as-is so the screens can
 * choose whether to parseFloat them or display as-is.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Shared shapes ──────────────────────────────────────────────────

export interface HppUnit {
  id: string
  value: string
  label: string
}

export interface TenantCategory {
  id: string
  name: string
  sortOrder: number
  isVisibleOnSitus: boolean
}

export interface HppSupplier {
  id: string
  name: string
  address: string | null
  phoneNumber: string | null
  personInCharge: string | null
  notes: string | null
}

export interface HppMaterial {
  id: string
  name: string
  brand: string | null
  unitId: string
  unit: string
  unitLabel: string
  pricePerUnit: string
  purchasePrice: string
  purchaseQty: string
  supplierId: string | null
  supplierName: string | null
  notes: string | null
}

export interface HppProductRow {
  id: string
  name: string
  sku: string | null
  category: string | null
  sellingPrice: string
  hpp: string | null
  margin: string | null
  productionQty: string | null
  productionUnit: string | null
  photoKey: string | null
  effectivePhotoKey: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface HppReport {
  products: HppProductRow[]
  materialCount: number
}

export interface ProductMaterialRow {
  id: string
  materialId: string | null
  sourceProductId: string | null
  quantity: string
  unit: string
  unitId: string
  addAt: 'prep' | 'finish'
  materialName: string | null
  materialBrand: string | null
  pricePerUnit: string | null
  supplierName: string | null
  subProductName: string | null
}

export interface ProductForEdit {
  product: HppProductRow
  materials: ProductMaterialRow[]
}

// ─── Read queries ───────────────────────────────────────────────────

export function useHppReport() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['hpp', 'report', tenantId],
    enabled: !!tenantId,
    queryFn: () => callServerFn<HppReport>('getHppReport', {}, { tenantId }),
  })
}

export function useHppUnits() {
  return useQuery({
    queryKey: ['hpp', 'units'],
    queryFn: () => callServerFn<HppUnit[]>('getHppUnits', {}),
    staleTime: 10 * 60 * 1000,
  })
}

export function useTenantCategories() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['hpp', 'categories', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<TenantCategory[]>('getTenantCategories', {}, { tenantId }),
  })
}

export function useHppSuppliers() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['hpp', 'suppliers', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<HppSupplier[]>('getSuppliers', {}, { tenantId }),
  })
}

export function useHppMaterials() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['hpp', 'materials', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<HppMaterial[]>('getMaterials', {}, { tenantId }),
  })
}

export function useHppProducts() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['hpp', 'products', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<HppProductRow[]>('getProducts', {}, { tenantId }),
  })
}

export function useProductForEdit(productId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['hpp', 'product-for-edit', tenantId, productId],
    enabled: !!tenantId && !!productId,
    queryFn: () =>
      callServerFn<ProductForEdit>(
        'getProductForEdit',
        { productId },
        { tenantId },
      ),
  })
}

export function useHppPhotoUrls(keys: string[]) {
  const { tenantId } = useTenant()
  const sorted = [...keys].sort().join(',')
  return useQuery({
    queryKey: ['hpp', 'photo-urls', tenantId, sorted],
    enabled: keys.length > 0,
    staleTime: 4 * 60 * 1000,
    queryFn: () =>
      callServerFn<Record<string, string | null>>(
        'getHppPhotoUrls',
        { keys },
        { tenantId },
      ),
  })
}

// ─── Mutations ──────────────────────────────────────────────────────

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['hpp'] })
  }
}

interface CreateProductInput {
  name: string
  sku?: string | null
  category?: string | null
  sellingPrice: string
  productionQty?: string | null
  productionUnit?: string | null
  notes?: string | null
}

interface UpdateProductInput extends Partial<CreateProductInput> {
  id: string
  hpp?: string | null
  margin?: string | null
}

export function useCreateProduct() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: CreateProductInput) =>
      callServerFn<HppProductRow>('createProduct', input, { tenantId }),
    onSuccess: invalidate,
  })
}

export function useUpdateProduct() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: UpdateProductInput) =>
      callServerFn<HppProductRow>('updateProduct', input, { tenantId }),
    onSuccess: invalidate,
  })
}

export function useDeleteProduct() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>('deleteProduct', { id }, { tenantId }),
    onSuccess: invalidate,
  })
}

export function useDuplicateProduct() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<HppProductRow>('duplicateProduct', { id }, { tenantId }),
    onSuccess: invalidate,
  })
}

interface ReplaceProductMaterialsInput {
  productId: string
  items: Array<{
    materialId?: string
    sourceProductId?: string
    quantity: string
    unitId: string
    addAt?: 'prep' | 'finish'
  }>
}

export function useReplaceProductMaterials() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: ReplaceProductMaterialsInput) =>
      callServerFn<{ rows: unknown[] }>(
        'replaceProductMaterials',
        input,
        { tenantId },
      ),
    onSuccess: invalidate,
  })
}

interface CalculateHppResult {
  productId: string
  productName: string
  totalMaterialCost: number
  hpp: number
  sellingPrice: number
  margin: number
  materialDetails: Array<{
    materialName: string
    quantity: number
    unit: string
    pricePerUnit: number
    totalCost: number
  }>
}

export function useCalculateProductHpp() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (productId: string) =>
      callServerFn<CalculateHppResult>(
        'calculateProductHpp',
        { productId },
        { tenantId },
      ),
    onSuccess: invalidate,
  })
}

interface CreateMaterialInput {
  name: string
  brand?: string | null
  unitId: string
  purchasePrice: string
  purchaseQty: string
  supplierId?: string | null
  notes?: string | null
}

export function useCreateMaterial() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: CreateMaterialInput) =>
      callServerFn<HppMaterial>('createMaterial', input, { tenantId }),
    onSuccess: invalidate,
  })
}

export function useFindOrCreateSupplier() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (name: string) =>
      callServerFn<HppSupplier>('findOrCreateSupplier', { name }, { tenantId }),
    onSuccess: invalidate,
  })
}

export function useCreateTenantCategory() {
  const { tenantId } = useTenant()
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (name: string) =>
      callServerFn<TenantCategory>(
        'createTenantCategory',
        { name },
        { tenantId },
      ),
    onSuccess: invalidate,
  })
}
