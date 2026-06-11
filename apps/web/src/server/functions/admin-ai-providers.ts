import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  aiProviderConfigs,
  aiProviderCapabilities,
  type ImageResolutionPricing,
} from '@vintra/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'

export type AiCapabilityKind = 'text' | 'image' | 'video'

// numeric columns surface as strings via Drizzle's postgres-js — null when
// unset. For text capabilities, null price columns mean the worker falls
// back to the hardcoded ai/pricing.go table.
export type AiProviderCapabilityRow = {
  id: string
  capability: AiCapabilityKind
  isDefault: boolean
  isActive: boolean
  inputPricePer1mUsd: string | null
  inputCacheHitPricePer1mUsd: string | null
  outputPricePer1mUsd: string | null
  imageResolutionPricing: ImageResolutionPricing | null
  pricePerSecondUsd: string | null
}

export type AiProviderConfig = {
  id: string
  name: string
  providerType: string
  model: string
  baseUrl: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  capabilities: AiProviderCapabilityRow[]
  // api_key is intentionally omitted from the list type
}

// Pricing fields are admin-set decimal strings stored as numeric(12,6).
// Empty string or "0" → null. For text capabilities a null lets the worker
// fall back to hardcoded pricing; for image/video it means "untracked".
const pricingField = z
  .string()
  .regex(/^(\d+(\.\d+)?)?$/, 'Harus angka desimal (mis. 0.27)')
  .transform((v) => {
    const trimmed = v.trim()
    if (trimmed === '' || trimmed === '0') return null
    return trimmed
  })
  .nullable()

// Per-resolution image pricing: how many credits a generation costs at
// that tier, and the platform's USD cost.
const resolutionTierSchema = z.object({
  credits: z.number().int().min(1).max(99),
  priceUsd: pricingField,
})
const imageResolutionPricingSchema = z.object({
  '1k': resolutionTierSchema,
  '2k': resolutionTierSchema,
  '4k': resolutionTierSchema,
})

const capabilitySchema = z.object({
  capability: z.enum(['text', 'image', 'video'], {
    message: 'Kapabilitas tidak valid',
  }),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  inputPricePer1mUsd: pricingField,
  inputCacheHitPricePer1mUsd: pricingField,
  outputPricePer1mUsd: pricingField,
  imageResolutionPricing: imageResolutionPricingSchema.nullable(),
  pricePerSecondUsd: pricingField,
})

const upsertSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(100),
  providerType: z.enum(['openai', 'gemini'], { message: 'Provider tidak valid' }),
  model: z.string().min(1, 'Model wajib diisi').max(100),
  baseUrl: z.string().url('URL tidak valid'),
  apiKey: z.string(),
  isActive: z.boolean(),
  capabilities: z
    .array(capabilitySchema)
    .min(1, 'Minimal satu kapabilitas')
    .refine(
      (arr) => new Set(arr.map((c) => c.capability)).size === arr.length,
      'Kapabilitas tidak boleh ganda',
    ),
})

type CapabilityInput = z.infer<typeof capabilitySchema>

function capabilityValues(configId: string, cap: CapabilityInput) {
  return {
    configId,
    capability: cap.capability,
    isDefault: cap.isDefault,
    isActive: cap.isActive,
    inputPricePer1MUsd: cap.inputPricePer1mUsd,
    inputCacheHitPricePer1MUsd: cap.inputCacheHitPricePer1mUsd,
    outputPricePer1MUsd: cap.outputPricePer1mUsd,
    imageResolutionPricing:
      cap.capability === 'image' ? cap.imageResolutionPricing : null,
    pricePerSecondUsd: cap.pricePerSecondUsd,
  }
}

export const listAiProviderConfigs = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requirePlatformAdmin()
    const [configs, caps] = await Promise.all([
      db
        .select({
          id: aiProviderConfigs.id,
          name: aiProviderConfigs.name,
          providerType: aiProviderConfigs.providerType,
          model: aiProviderConfigs.model,
          baseUrl: aiProviderConfigs.baseUrl,
          isActive: aiProviderConfigs.isActive,
          createdAt: aiProviderConfigs.createdAt,
          updatedAt: aiProviderConfigs.updatedAt,
        })
        .from(aiProviderConfigs)
        .orderBy(asc(aiProviderConfigs.createdAt)),
      db
        .select({
          id: aiProviderCapabilities.id,
          configId: aiProviderCapabilities.configId,
          capability: aiProviderCapabilities.capability,
          isDefault: aiProviderCapabilities.isDefault,
          isActive: aiProviderCapabilities.isActive,
          inputPricePer1mUsd: aiProviderCapabilities.inputPricePer1MUsd,
          inputCacheHitPricePer1mUsd:
            aiProviderCapabilities.inputCacheHitPricePer1MUsd,
          outputPricePer1mUsd: aiProviderCapabilities.outputPricePer1MUsd,
          imageResolutionPricing:
            aiProviderCapabilities.imageResolutionPricing,
          pricePerSecondUsd: aiProviderCapabilities.pricePerSecondUsd,
        })
        .from(aiProviderCapabilities),
    ])

    const byConfig = new Map<string, AiProviderCapabilityRow[]>()
    for (const c of caps) {
      const row: AiProviderCapabilityRow = {
        id: c.id,
        capability: c.capability as AiCapabilityKind,
        isDefault: c.isDefault,
        isActive: c.isActive,
        inputPricePer1mUsd: c.inputPricePer1mUsd,
        inputCacheHitPricePer1mUsd: c.inputCacheHitPricePer1mUsd,
        outputPricePer1mUsd: c.outputPricePer1mUsd,
        imageResolutionPricing: c.imageResolutionPricing ?? null,
        pricePerSecondUsd: c.pricePerSecondUsd,
      }
      const list = byConfig.get(c.configId)
      if (list) list.push(row)
      else byConfig.set(c.configId, [row])
    }

    return configs.map(
      (cfg): AiProviderConfig => ({
        ...cfg,
        capabilities: byConfig.get(cfg.id) ?? [],
      }),
    )
  },
)

// Clears is_default on every OTHER config's capability row of the given
// kinds, so the partial unique index (capability) WHERE is_default holds.
async function clearConflictingDefaults(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  capabilities: CapabilityInput[],
) {
  for (const cap of capabilities) {
    if (!cap.isDefault) continue
    await tx
      .update(aiProviderCapabilities)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(aiProviderCapabilities.capability, cap.capability),
          eq(aiProviderCapabilities.isDefault, true),
        ),
      )
  }
}

export const createAiProviderConfig = createServerFn({ method: 'POST' })
  .inputValidator(upsertSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    if (!data.apiKey) throw new Error('API Key wajib diisi')

    return db.transaction(async (tx) => {
      const [cfg] = await tx
        .insert(aiProviderConfigs)
        .values({
          name: data.name,
          providerType: data.providerType,
          model: data.model,
          baseUrl: data.baseUrl,
          apiKey: data.apiKey,
          isActive: data.isActive,
        })
        .returning({ id: aiProviderConfigs.id })

      await clearConflictingDefaults(tx, data.capabilities)
      await tx
        .insert(aiProviderCapabilities)
        .values(data.capabilities.map((cap) => capabilityValues(cfg!.id, cap)))

      return { id: cfg!.id }
    })
  })

export const updateAiProviderConfig = createServerFn({ method: 'POST' })
  .inputValidator(upsertSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    // Empty apiKey on edit means "keep the existing key".
    const configValues: Partial<typeof aiProviderConfigs.$inferInsert> = {
      name: data.name,
      providerType: data.providerType,
      model: data.model,
      baseUrl: data.baseUrl,
      isActive: data.isActive,
      updatedAt: new Date(),
    }
    if (data.apiKey !== '') configValues.apiKey = data.apiKey

    return db.transaction(async (tx) => {
      await tx
        .update(aiProviderConfigs)
        .set(configValues)
        .where(eq(aiProviderConfigs.id, data.id))

      // Capability rows are replaced wholesale — simplest correct path for
      // an admin form that submits the full capability set every time.
      await tx
        .delete(aiProviderCapabilities)
        .where(eq(aiProviderCapabilities.configId, data.id))
      await clearConflictingDefaults(tx, data.capabilities)
      await tx
        .insert(aiProviderCapabilities)
        .values(data.capabilities.map((cap) => capabilityValues(data.id, cap)))

      return { id: data.id }
    })
  })

export const deleteAiProviderConfig = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    // Capability rows cascade-delete via the FK.
    await db.delete(aiProviderConfigs).where(eq(aiProviderConfigs.id, data.id))
    return null
  })
