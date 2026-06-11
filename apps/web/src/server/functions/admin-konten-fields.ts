import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  kontenPromptFields,
  kontenPromptFieldOptions,
  kontenSettings,
  type KontenOptionTextInput,
} from '@vintra/db/schema'
import { eq, asc } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type KontenFieldOption = {
  id: string
  label: string
  promptFragment: string
  textInputs: KontenOptionTextInput[] | null
  sortOrder: number
  isActive: boolean
}

export type KontenField = {
  id: string
  key: string
  label: string
  helpText: string | null
  allowsCustom: boolean
  required: boolean
  sortOrder: number
  isActive: boolean
  options: KontenFieldOption[]
}

// Field keys double as {placeholders} in the prompt template, so they
// must be safe identifiers.
const fieldKeySchema = z
  .string()
  .min(1, 'Key wajib diisi')
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Key: huruf kecil, angka, garis bawah')

export const listKontenPromptFields = createServerFn({
  method: 'POST',
}).handler(async (): Promise<KontenField[]> => {
  await requirePlatformAdmin()
  const [fields, options] = await Promise.all([
    db
      .select()
      .from(kontenPromptFields)
      .orderBy(asc(kontenPromptFields.sortOrder)),
    db
      .select()
      .from(kontenPromptFieldOptions)
      .orderBy(asc(kontenPromptFieldOptions.sortOrder)),
  ])

  const byField = new Map<string, KontenFieldOption[]>()
  for (const o of options) {
    const row: KontenFieldOption = {
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
    (f): KontenField => ({
      id: f.id,
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      allowsCustom: f.allowsCustom,
      required: f.required,
      sortOrder: f.sortOrder,
      isActive: f.isActive,
      options: byField.get(f.id) ?? [],
    }),
  )
})

export const getKontenTemplate = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ template: string }> => {
    await requirePlatformAdmin()
    const [row] = await db.select().from(kontenSettings).limit(1)
    return { template: row?.promptTemplate ?? '' }
  },
)

export const saveKontenTemplate = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ template: z.string().max(4000) }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [existing] = await db
      .select({ id: kontenSettings.id })
      .from(kontenSettings)
      .limit(1)
    if (existing) {
      await db
        .update(kontenSettings)
        .set({ promptTemplate: data.template, updatedAt: new Date() })
        .where(eq(kontenSettings.id, existing.id))
    } else {
      await db.insert(kontenSettings).values({ promptTemplate: data.template })
    }
    return null
  })

const fieldInputSchema = z.object({
  key: fieldKeySchema,
  label: z.string().min(1, 'Label wajib diisi').max(80),
  helpText: z.string().max(300).optional(),
  allowsCustom: z.boolean(),
  required: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

export const createKontenField = createServerFn({ method: 'POST' })
  .inputValidator(fieldInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(kontenPromptFields)
      .values({
        key: data.key,
        label: data.label,
        helpText: data.helpText || null,
        allowsCustom: data.allowsCustom,
        required: data.required,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      })
      .returning({ id: kontenPromptFields.id })
    return { id: row!.id }
  })

export const updateKontenField = createServerFn({ method: 'POST' })
  .inputValidator(fieldInputSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(kontenPromptFields)
      .set({
        key: data.key,
        label: data.label,
        helpText: data.helpText || null,
        allowsCustom: data.allowsCustom,
        required: data.required,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(eq(kontenPromptFields.id, data.id))
    return null
  })

export const deleteKontenField = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    // Options cascade-delete via the FK.
    await db.delete(kontenPromptFields).where(eq(kontenPromptFields.id, data.id))
    return null
  })

const optionInputSchema = z.object({
  fieldId: z.string().uuid(),
  label: z.string().min(1, 'Label wajib diisi').max(80),
  promptFragment: z.string().min(1, 'Fragmen prompt wajib diisi').max(1000),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

export const createKontenFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(optionInputSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .insert(kontenPromptFieldOptions)
      .values(data)
      .returning({ id: kontenPromptFieldOptions.id })
    return { id: row!.id }
  })

export const updateKontenFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(
    optionInputSchema.omit({ fieldId: true }).extend({ id: z.string().uuid() }),
  )
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(kontenPromptFieldOptions)
      .set({
        label: data.label,
        promptFragment: data.promptFragment,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
      })
      .where(eq(kontenPromptFieldOptions.id, data.id))
    return null
  })

export const deleteKontenFieldOption = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .delete(kontenPromptFieldOptions)
      .where(eq(kontenPromptFieldOptions.id, data.id))
    return null
  })
