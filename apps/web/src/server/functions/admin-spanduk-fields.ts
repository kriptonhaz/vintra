import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  spandukPromptFields,
  spandukPromptFieldOptions,
  spandukSettings,
  spandukSizePresets,
  type KontenOptionTextInput,
  type SpandukType,
  type SpandukTextLayout,
} from '@vintra/db/schema'
import { eq, asc } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type SpandukFieldType = 'select' | 'text'

export type SpandukFieldOption = {
  id: string
  label: string
  promptFragment: string
  textInputs: KontenOptionTextInput[] | null
  sortOrder: number
  isActive: boolean
}

export type SpandukField = {
  id: string
  key: string
  label: string
  helpText: string | null
  fieldType: SpandukFieldType
  allowsCustom: boolean
  required: boolean
  sortOrder: number
  isActive: boolean
  options: SpandukFieldOption[]
}

export type SpandukSizePreset = {
  id: string
  type: SpandukType
  label: string
  widthCm: number
  heightCm: number
  sortOrder: number
  isActive: boolean
}

const SPANDUK_TYPES = ['xbanner', 'spanduk'] as const

const fieldKeySchema = z
  .string()
  .min(1, 'Key wajib diisi')
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Key: huruf kecil, angka, garis bawah')

// ── Fields + options ──────────────────────────────────────────────────

export const listSpandukPromptFields = createServerFn({
  method: 'POST',
}).handler(async (): Promise<SpandukField[]> => {
  await requirePlatformAdmin()
  const [fields, options] = await Promise.all([
    db
      .select()
      .from(spandukPromptFields)
      .orderBy(asc(spandukPromptFields.sortOrder)),
    db
      .select()
      .from(spandukPromptFieldOptions)
      .orderBy(asc(spandukPromptFieldOptions.sortOrder)),
  ])

  const byField = new Map<string, SpandukFieldOption[]>()
  for (const o of options) {
    const row: SpandukFieldOption = {
      id: o.id,
      label: o.label,
      promptFragment: o.promptFragment,
      textInputs: o.textInputs ?? null,
      sortOrder: o.sortOrder,
      isActive: o.isActive,
    }
    const list = byField.get(o.fieldId)
    if (list) list.push(row)
    else byField.set(o.fieldId, [row])
  }

  return fields.map(
    (f): SpandukField => ({
      id: f.id,
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      fieldType: (f.fieldType as SpandukFieldType) ?? 'select',
      allowsCustom: f.allowsCustom,
      required: f.required,
      sortOrder: f.sortOrder,
      isActive: f.isActive,
      options: byField.get(f.id) ?? [],
    }),
  )
})

const fieldInputSchema = z.object({
  key: fieldKeySchema,
  label: z.string().min(1, 'Label wajib diisi').max(80),
  helpText: z.string().max(300).optional(),
  fieldType: z.enum(['select', 'text']),
  allowsCustom: z.boolean(),
  required: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

export const createSpandukField = createServerFn({ method: 'POST' })
  .inputValidator(fieldInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(spandukPromptFields)
      .values({
        key: data.key,
        label: data.label,
        helpText: data.helpText || null,
        fieldType: data.fieldType,
        allowsCustom: data.allowsCustom,
        required: data.required,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      })
      .returning({ id: spandukPromptFields.id })
    return { id: row!.id }
  })

export const updateSpandukField = createServerFn({ method: 'POST' })
  .inputValidator(fieldInputSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(spandukPromptFields)
      .set({
        key: data.key,
        label: data.label,
        helpText: data.helpText || null,
        fieldType: data.fieldType,
        allowsCustom: data.allowsCustom,
        required: data.required,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(eq(spandukPromptFields.id, data.id))
    return null
  })

export const deleteSpandukField = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .delete(spandukPromptFields)
      .where(eq(spandukPromptFields.id, data.id))
    return null
  })

const optionInputSchema = z.object({
  fieldId: z.string().uuid(),
  label: z.string().min(1, 'Label wajib diisi').max(80),
  promptFragment: z.string().min(1, 'Fragmen prompt wajib diisi').max(1000),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

export const createSpandukFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(optionInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(spandukPromptFieldOptions)
      .values(data)
      .returning({ id: spandukPromptFieldOptions.id })
    return { id: row!.id }
  })

export const updateSpandukFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(
    optionInputSchema.omit({ fieldId: true }).extend({ id: z.string().uuid() }),
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(spandukPromptFieldOptions)
      .set({
        label: data.label,
        promptFragment: data.promptFragment,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      })
      .where(eq(spandukPromptFieldOptions.id, data.id))
    return null
  })

export const deleteSpandukFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .delete(spandukPromptFieldOptions)
      .where(eq(spandukPromptFieldOptions.id, data.id))
    return null
  })

// ── Settings (singleton) ──────────────────────────────────────────────

export const getSpandukAdminSettings = createServerFn({
  method: 'POST',
}).handler(
  async (): Promise<{
    template: string
    defaultCreditCost: number
    textLayout: SpandukTextLayout | null
  }> => {
    await requirePlatformAdmin()
    const [row] = await db.select().from(spandukSettings).limit(1)
    return {
      template: row?.promptTemplate ?? '',
      defaultCreditCost: row?.defaultCreditCost ?? 6,
      textLayout: row?.textLayout ?? null,
    }
  },
)

const textLayoutSchema = z.object({
  stripHeightPct: z.number().min(0).max(1),
  stripBgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Format warna: #RRGGBB'),
  stripOpacity: z.number().min(0).max(1),
  headlineFont: z.string().min(1).max(60),
  headlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Format warna: #RRGGBB'),
  subheadFont: z.string().min(1).max(60),
  subheadColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Format warna: #RRGGBB'),
  contactFont: z.string().min(1).max(60),
  contactColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Format warna: #RRGGBB'),
})

export const saveSpandukAdminSettings = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      template: z.string().max(4000),
      defaultCreditCost: z.number().int().min(1).max(100),
      textLayout: textLayoutSchema,
    }),
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [existing] = await db
      .select({ id: spandukSettings.id })
      .from(spandukSettings)
      .limit(1)
    if (existing) {
      await db
        .update(spandukSettings)
        .set({
          promptTemplate: data.template,
          defaultCreditCost: data.defaultCreditCost,
          textLayout: data.textLayout,
          updatedAt: new Date(),
        })
        .where(eq(spandukSettings.id, existing.id))
    } else {
      await db.insert(spandukSettings).values({
        promptTemplate: data.template,
        defaultCreditCost: data.defaultCreditCost,
        textLayout: data.textLayout,
      })
    }
    return null
  })

// ── Size presets ──────────────────────────────────────────────────────

export const listSpandukSizePresets = createServerFn({
  method: 'POST',
}).handler(async (): Promise<SpandukSizePreset[]> => {
  await requirePlatformAdmin()
  const rows = await db
    .select()
    .from(spandukSizePresets)
    .orderBy(asc(spandukSizePresets.type), asc(spandukSizePresets.sortOrder))
  return rows.map((r) => ({
    id: r.id,
    type: r.type as SpandukType,
    label: r.label,
    widthCm: r.widthCm,
    heightCm: r.heightCm,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  }))
})

const sizeInputSchema = z.object({
  type: z.enum(SPANDUK_TYPES),
  label: z.string().min(1, 'Label wajib diisi').max(80),
  widthCm: z.number().int().min(10, 'Min 10 cm').max(2000, 'Maks 20 m'),
  heightCm: z.number().int().min(10, 'Min 10 cm').max(2000, 'Maks 20 m'),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

export const createSpandukSize = createServerFn({ method: 'POST' })
  .inputValidator(sizeInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(spandukSizePresets)
      .values(data)
      .returning({ id: spandukSizePresets.id })
    return { id: row!.id }
  })

export const updateSpandukSize = createServerFn({ method: 'POST' })
  .inputValidator(sizeInputSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(spandukSizePresets)
      .set({
        type: data.type,
        label: data.label,
        widthCm: data.widthCm,
        heightCm: data.heightCm,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      })
      .where(eq(spandukSizePresets.id, data.id))
    return null
  })

export const deleteSpandukSize = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .delete(spandukSizePresets)
      .where(eq(spandukSizePresets.id, data.id))
    return null
  })
