import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  logoPromptFields,
  logoPromptFieldOptions,
  logoSettings,
  type KontenOptionTextInput,
} from '@vintra/db/schema'
import { eq, asc } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type LogoFieldType = 'select' | 'text'

export type LogoFieldOption = {
  id: string
  label: string
  promptFragment: string
  textInputs: KontenOptionTextInput[] | null
  sortOrder: number
  isActive: boolean
}

export type LogoField = {
  id: string
  key: string
  label: string
  helpText: string | null
  fieldType: LogoFieldType
  allowsCustom: boolean
  required: boolean
  sortOrder: number
  isActive: boolean
  options: LogoFieldOption[]
}

const fieldKeySchema = z
  .string()
  .min(1, 'Key wajib diisi')
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Key: huruf kecil, angka, garis bawah')

export const listLogoPromptFields = createServerFn({
  method: 'POST',
}).handler(async (): Promise<LogoField[]> => {
  await requirePlatformAdmin()
  const [fields, options] = await Promise.all([
    db.select().from(logoPromptFields).orderBy(asc(logoPromptFields.sortOrder)),
    db
      .select()
      .from(logoPromptFieldOptions)
      .orderBy(asc(logoPromptFieldOptions.sortOrder)),
  ])

  const byField = new Map<string, LogoFieldOption[]>()
  for (const o of options) {
    const row: LogoFieldOption = {
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
    (f): LogoField => ({
      id: f.id,
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      fieldType: (f.fieldType as LogoFieldType) ?? 'select',
      allowsCustom: f.allowsCustom,
      required: f.required,
      sortOrder: f.sortOrder,
      isActive: f.isActive,
      options: byField.get(f.id) ?? [],
    }),
  )
})

export const getLogoTemplate = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ template: string }> => {
    await requirePlatformAdmin()
    const [row] = await db.select().from(logoSettings).limit(1)
    return { template: row?.promptTemplate ?? '' }
  },
)

export const saveLogoTemplate = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ template: z.string().max(4000) }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [existing] = await db
      .select({ id: logoSettings.id })
      .from(logoSettings)
      .limit(1)
    if (existing) {
      await db
        .update(logoSettings)
        .set({ promptTemplate: data.template, updatedAt: new Date() })
        .where(eq(logoSettings.id, existing.id))
    } else {
      await db.insert(logoSettings).values({ promptTemplate: data.template })
    }
    return null
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

export const createLogoField = createServerFn({ method: 'POST' })
  .inputValidator(fieldInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(logoPromptFields)
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
      .returning({ id: logoPromptFields.id })
    return { id: row!.id }
  })

export const updateLogoField = createServerFn({ method: 'POST' })
  .inputValidator(fieldInputSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(logoPromptFields)
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
      .where(eq(logoPromptFields.id, data.id))
    return null
  })

export const deleteLogoField = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db.delete(logoPromptFields).where(eq(logoPromptFields.id, data.id))
    return null
  })

const optionInputSchema = z.object({
  fieldId: z.string().uuid(),
  label: z.string().min(1, 'Label wajib diisi').max(80),
  promptFragment: z.string().min(1, 'Fragmen prompt wajib diisi').max(1000),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

export const createLogoFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(optionInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(logoPromptFieldOptions)
      .values(data)
      .returning({ id: logoPromptFieldOptions.id })
    return { id: row!.id }
  })

export const updateLogoFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(
    optionInputSchema.omit({ fieldId: true }).extend({ id: z.string().uuid() }),
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(logoPromptFieldOptions)
      .set({
        label: data.label,
        promptFragment: data.promptFragment,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      })
      .where(eq(logoPromptFieldOptions.id, data.id))
    return null
  })

export const deleteLogoFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .delete(logoPromptFieldOptions)
      .where(eq(logoPromptFieldOptions.id, data.id))
    return null
  })
