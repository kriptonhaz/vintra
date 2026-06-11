import { z } from 'zod'

// Error message keys — resolved via i18n at render time
const E = {
  nameRequired: 'validation.nameRequired',
  selectFromList: 'validation.selectFromList',
  qtyRequired: 'validation.qtyRequired',
  qtyPositive: 'validation.qtyPositive',
  priceRequired: 'validation.priceRequired',
  pricePositive: 'validation.pricePositive',
  productNameRequired: 'validation.productNameRequired',
  categoryRequired: 'validation.categoryRequired',
  productionQtyRequired: 'validation.productionQtyRequired',
  productionQtyPositive: 'validation.productionQtyPositive',
  productionUnitRequired: 'validation.productionUnitRequired',
  minCostItems: 'validation.minCostItems',
  marginRequired: 'validation.marginRequired',
  marginRange: 'validation.marginRange',
  sellingPriceRequired: 'validation.sellingPriceRequired',
  sellingPricePositive: 'validation.sellingPricePositive',
} as const

const costItemSchema = z
  .object({
    name: z.string(),
    materialId: z.string().optional(),
    productId: z.string().optional(),
    brand: z.string(),
    supplier: z.string(),
    quantity: z.string(),
    unit: z.string(),
    pricePerUnit: z.string(),
    /**
     * JUR-15 v2: when this ingredient is added in the cooking workflow.
     * 'prep' (default) = consumed at prep batch creation or per sale
     * (current behavior). 'finish' = always per sale even when prep
     * mode is on (warung kopi: gula/susu added at counter).
     */
    addAt: z.enum(['prep', 'finish']).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.name.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: E.nameRequired,
        path: ['name'],
      })
    } else if (!data.materialId && !data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: E.selectFromList,
        path: ['name'],
      })
    }

    if (!data.quantity || parseFloat(data.quantity) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: !data.quantity ? E.qtyRequired : E.qtyPositive,
        path: ['quantity'],
      })
    }
    if (!data.pricePerUnit || parseFloat(data.pricePerUnit) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: !data.pricePerUnit ? E.priceRequired : E.pricePositive,
        path: ['pricePerUnit'],
      })
    }
  })

export const hppCalculateSchema = z
  .object({
    // Step 1
    productName: z.string().min(1, E.productNameRequired),
    sku: z.string(),
    category: z.string().min(1, E.categoryRequired),
    productionQty: z.string().min(1, E.productionQtyRequired).refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      E.productionQtyPositive,
    ),
    productionUnit: z.string().min(1, E.productionUnitRequired),
    notes: z.string(),
    // Step 2
    costItems: z
      .array(costItemSchema)
      .min(1, E.minCostItems),
    // Step 3
    targetMargin: z
      .string()
      .min(1, E.marginRequired)
      .refine((v) => {
        const n = parseFloat(v)
        return !isNaN(n) && n > 0 && n < 100
      }, E.marginRange),
    sellingPrice: z
      .string()
      .min(1, E.sellingPriceRequired)
      .refine(
        (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
        E.sellingPricePositive,
      ),
    competitors: z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
    }),
  })

export type HppCalculateFormData = z.infer<typeof hppCalculateSchema>
export type CostItemData = HppCalculateFormData['costItems'][number]

// Per-step field name arrays for trigger()
export const STEP_FIELDS = {
  1: ['productName', 'category', 'productionQty', 'productionUnit'] as const,
  2: ['costItems'] as const,
  3: ['targetMargin', 'sellingPrice'] as const,
}
