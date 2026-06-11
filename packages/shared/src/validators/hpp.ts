import { z } from 'zod'

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Nama supplier wajib diisi'),
  address: z.string().optional(),
  phoneNumber: z.string().optional(),
  personInCharge: z.string().optional(),
  notes: z.string().optional(),
})

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  id: z.string().uuid(),
})

export const createMaterialSchema = z.object({
  name: z.string().min(1, 'Nama bahan wajib diisi'),
  brand: z.string().optional(),
  // JUR-14: switched from `unit: text` to `unitId: uuid` FK to
  // master_hpp_units. Form picker now stores the unit id directly.
  unitId: z.string().uuid('Satuan wajib dipilih'),
  purchasePrice: z.string().min(1, 'Harga beli wajib diisi').refine(
    (v) => Number(v) > 0,
    'Harga beli harus lebih dari 0',
  ),
  purchaseQty: z.string().min(1, 'Jumlah per kemasan wajib diisi').refine(
    (v) => Number(v) > 0,
    'Jumlah harus lebih dari 0',
  ),
  supplierId: z.string().uuid().optional().or(z.literal('')),
  notes: z.string().optional(),
})

export const updateMaterialSchema = createMaterialSchema.partial().extend({
  id: z.string().uuid(),
})

export const createProductSchema = z.object({
  name: z.string().min(1, 'Nama produk wajib diisi'),
  sku: z.string().optional(),
  category: z.string().optional(),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Harga jual tidak valid'),
  productionQty: z.string().optional(),
  productionUnit: z.string().optional(),
  notes: z.string().optional(),
})

export const updateProductSchema = createProductSchema.partial().extend({
  id: z.string().uuid(),
})

export const createProductMaterialSchema = z.object({
  productId: z.string().uuid('Produk wajib dipilih'),
  materialId: z.string().uuid('Bahan baku wajib dipilih'),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Jumlah tidak valid'),
  // JUR-14: unit text → unitId FK.
  unitId: z.string().uuid('Satuan wajib dipilih'),
  // JUR-15 v2: 'prep' (default) consumes ingredient at prep batch time;
  // 'finish' defers to per-sale even when prep_mode is on (warung kopi
  // pattern: tea is brewed in bulk but sugar is added per cup).
  addAt: z.enum(['prep', 'finish']).optional(),
})

export const updateProductMaterialSchema = createProductMaterialSchema.partial().extend({
  id: z.string().uuid(),
})

export const createOverheadSchema = z.object({
  name: z.string().min(1, 'Nama biaya wajib diisi'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Jumlah biaya tidak valid'),
  period: z.enum(['daily', 'weekly', 'monthly'], {
    errorMap: () => ({ message: 'Periode tidak valid' }),
  }),
  allocationType: z.enum(['per_product', 'percentage'], {
    errorMap: () => ({ message: 'Tipe alokasi tidak valid' }),
  }),
  notes: z.string().optional(),
})

export const updateOverheadSchema = createOverheadSchema.partial().extend({
  id: z.string().uuid(),
})

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Nama kategori wajib diisi'),
  sortOrder: z.number().int().optional(),
  isVisibleOnSitus: z.boolean().optional(),
})

export const updateCategorySchema = createCategorySchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>
export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type CreateProductMaterialInput = z.infer<typeof createProductMaterialSchema>
export type UpdateProductMaterialInput = z.infer<typeof updateProductMaterialSchema>
export type CreateOverheadInput = z.infer<typeof createOverheadSchema>
export type UpdateOverheadInput = z.infer<typeof updateOverheadSchema>
