import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  logos,
  logoPromptFields,
  logoPromptFieldOptions,
  logoSettings,
  kontenCreditAccounts,
  aiUsageLogs,
  type KontenSelectionSnapshot,
  type KontenOptionTextInput,
} from '@vintra/db/schema'
import { and, eq, asc, desc } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import { applyKontenCredit } from './admin-konten-credits'
import {
  uploadLogoImage,
  getLogoImageSignedUrl,
  getLogoImageDownloadSignedUrl,
  deleteLogoImage as deleteLogoImageObject,
} from '@/lib/s3-storage'
import { generateGeminiImage } from '@/lib/ai-image'
import {
  KONTEN_RESOLUTIONS,
  GEMINI_IMAGE_SIZE,
} from '@/lib/konten-presets'
import { getDefaultImageProvider, resolvePricing } from '@/server/lib/ai-image-provider'

const LOGO_USAGE_FEATURE = 'logo_image_gen'

export type LogoRow = {
  id: string
  status: string
  prompt: string
  selections: KontenSelectionSnapshot[]
  resolution: string | null
  resultImageUrl: string | null
  errorMessage: string | null
  createdAt: Date
}

export type LogoPromptField = {
  key: string
  label: string
  helpText: string | null
  fieldType: 'select' | 'text'
  allowsCustom: boolean
  required: boolean
  options: {
    id: string
    label: string
    textInputs?: KontenOptionTextInput[] | null
  }[]
}

const selectionInputSchema = z.object({
  fieldKey: z.string().max(40),
  optionId: z.string().uuid().optional(),
  customValue: z.string().max(400).optional(),
  textInputs: z.record(z.string(), z.string().max(400)).optional(),
})

/**
 * Builds the logo prompt from the tenant's selections plus the
 * admin-configured template, and snapshots the choices. Handles both
 * 'select' fields (option fragments) and 'text' fields (raw typed value
 * substituted directly into the template).
 */
async function assembleLogoPrompt(
  selections: z.infer<typeof selectionInputSchema>[],
): Promise<{ prompt: string; snapshot: KontenSelectionSnapshot[] }> {
  const [fields, options, settingsRows] = await Promise.all([
    db
      .select()
      .from(logoPromptFields)
      .where(eq(logoPromptFields.isActive, true))
      .orderBy(asc(logoPromptFields.sortOrder)),
    db
      .select()
      .from(logoPromptFieldOptions)
      .where(eq(logoPromptFieldOptions.isActive, true)),
    db.select().from(logoSettings).limit(1),
  ])
  const optionById = new Map(options.map((o) => [o.id, o]))

  const snapshot: KontenSelectionSnapshot[] = []
  const fragmentByKey = new Map<string, string>()

  for (const field of fields) {
    const sel = selections.find((s) => s.fieldKey === field.key)
    let fragment = ''
    let displayValue = ''
    let isCustom = false
    let textInputsSnapshot:
      | KontenSelectionSnapshot['textInputs']
      | undefined

    if (field.fieldType === 'text') {
      // Free-text field — typed value is both the fragment and display.
      const raw = (sel?.customValue ?? '').trim()
      if (raw) {
        fragment = raw
        displayValue = raw
        isCustom = true
      }
    } else if (sel?.optionId) {
      const opt = optionById.get(sel.optionId)
      if (opt && opt.fieldId === field.id) {
        fragment = opt.promptFragment
        displayValue = opt.label

        if (opt.textInputs && opt.textInputs.length > 0 && sel.textInputs) {
          const snap: NonNullable<typeof textInputsSnapshot> = []
          for (const def of opt.textInputs) {
            const raw = (sel.textInputs[def.key] ?? '').trim()
            fragment = fragment.split(`{${def.key}}`).join(raw)
            if (raw) snap.push({ key: def.key, label: def.label, value: raw })
          }
          if (snap.length > 0) textInputsSnapshot = snap
          fragment = fragment
            .split('\n')
            .filter((line) => !/^[\s-]*[A-Za-z ]+:\s*""\s*$/.test(line))
            .join('\n')
        }
      }
    } else if (sel?.customValue?.trim()) {
      if (!field.allowsCustom) {
        throw new Error(`${field.label} tidak menerima input bebas.`)
      }
      fragment = sel.customValue.trim()
      displayValue = sel.customValue.trim()
      isCustom = true
    }

    if (!displayValue) {
      if (field.required) throw new Error(`${field.label} wajib diisi.`)
      continue
    }
    snapshot.push({
      fieldKey: field.key,
      fieldLabel: field.label,
      value: displayValue,
      isCustom,
      ...(textInputsSnapshot ? { textInputs: textInputsSnapshot } : {}),
    })
    fragmentByKey.set(field.key, fragment)
  }

  let prompt = (settingsRows[0]?.promptTemplate ?? '').trim()
  if (prompt) {
    for (const [key, frag] of fragmentByKey) {
      prompt = prompt.split(`{${key}}`).join(frag)
    }
    prompt = prompt.replace(/\{[a-z0-9_]+\}/gi, '')
  } else {
    prompt = [...fragmentByKey.values()].join('\n\n')
  }
  // Strip lines whose only payload was an empty user value (e.g. an
  // empty tagline placeholder line).
  prompt = prompt
    .split('\n')
    .filter((line) => !/^[\s-]*[A-Za-z ]+:\s*""\s*$/.test(line))
    .join('\n')
  prompt = prompt
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!prompt) throw new Error('Isi minimal nama bisnis untuk membuat logo.')
  return { prompt, snapshot }
}

export const getLogoStatus = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { tenantId } = await requireAuth()
    // Shared credit pool with Konten Promosi.
    const [account] = await db
      .select({ balance: kontenCreditAccounts.balance })
      .from(kontenCreditAccounts)
      .where(eq(kontenCreditAccounts.tenantId, tenantId))
      .limit(1)
    const provider = await getDefaultImageProvider()
    const pricing = resolvePricing(provider?.imageResolutionPricing ?? null)
    return {
      balance: account?.balance ?? 0,
      hasImageProvider: provider !== null,
      resolutions: KONTEN_RESOLUTIONS.map((key) => ({
        key,
        credits: pricing[key].credits,
      })),
    }
  },
)

export const getLogoPromptConfig = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ fields: LogoPromptField[] }> => {
    await requireAuth()
    const [fields, options] = await Promise.all([
      db
        .select()
        .from(logoPromptFields)
        .where(eq(logoPromptFields.isActive, true))
        .orderBy(asc(logoPromptFields.sortOrder)),
      db
        .select()
        .from(logoPromptFieldOptions)
        .where(eq(logoPromptFieldOptions.isActive, true))
        .orderBy(asc(logoPromptFieldOptions.sortOrder)),
    ])
    const byField = new Map<string, LogoPromptField['options']>()
    for (const o of options) {
      const item = {
        id: o.id,
        label: o.label,
        textInputs: o.textInputs ?? null,
      }
      const list = byField.get(o.fieldId)
      if (list) list.push(item)
      else byField.set(o.fieldId, [item])
    }
    return {
      fields: fields.map(
        (f): LogoPromptField => ({
          key: f.key,
          label: f.label,
          helpText: f.helpText,
          fieldType: (f.fieldType as 'select' | 'text') ?? 'select',
          allowsCustom: f.allowsCustom,
          required: f.required,
          options: byField.get(f.id) ?? [],
        }),
      ),
    }
  },
)

export const listLogos = createServerFn({ method: 'POST' }).handler(
  async (): Promise<LogoRow[]> => {
    const { tenantId } = await requireAuth()
    const rows = await db
      .select()
      .from(logos)
      .where(eq(logos.tenantId, tenantId))
      .orderBy(desc(logos.createdAt))
      .limit(60)

    return Promise.all(
      rows.map(async (r): Promise<LogoRow> => {
        const resultImageUrl = r.resultImageKey
          ? await getLogoImageSignedUrl(r.resultImageKey)
          : null
        return {
          id: r.id,
          status: r.status,
          prompt: r.prompt,
          selections: r.selections ?? [],
          resolution: r.resolution,
          resultImageUrl,
          errorMessage: r.errorMessage,
          createdAt: r.createdAt,
        }
      }),
    )
  },
)

export const generateLogo = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      selections: z.array(selectionInputSchema).default([]),
      resolution: z.enum(KONTEN_RESOLUTIONS).default('1k'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()
    const resolution = data.resolution

    const { prompt, snapshot } = await assembleLogoPrompt(data.selections)

    const provider = await getDefaultImageProvider()
    if (!provider) {
      throw new Error(
        'Belum ada provider gambar AI yang dikonfigurasi. Hubungi admin.',
      )
    }
    if (provider.providerType !== 'gemini') {
      throw new Error(
        'Provider gambar AI saat ini hanya mendukung Google Gemini.',
      )
    }

    const tier = resolvePricing(provider.imageResolutionPricing)[resolution]
    const credits = tier.credits

    // Shared credit pool with Konten — pre-flight check.
    const [account] = await db
      .select({ balance: kontenCreditAccounts.balance })
      .from(kontenCreditAccounts)
      .where(eq(kontenCreditAccounts.tenantId, tenantId))
      .limit(1)
    if ((account?.balance ?? 0) < credits) {
      throw new Error(
        'Saldo kredit Konten tidak cukup. Hubungi admin untuk menambah kredit.',
      )
    }

    const [created] = await db
      .insert(logos)
      .values({
        tenantId,
        status: 'pending',
        prompt,
        selections: snapshot,
        resolution,
        providerConfigId: provider.configId,
        model: provider.model,
        createdBy: userId,
      })
      .returning({ id: logos.id })
    const logoId = created!.id

    const startedAt = Date.now()
    try {
      // Text-to-image — no sourceImage, just the prompt. The prompt
      // template carries the "1:1 square" instruction; we don't
      // duplicate that signal via imageConfig.aspectRatio.
      const result = await generateGeminiImage({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        prompt,
        imageSize: GEMINI_IMAGE_SIZE[resolution],
      })

      const { key: resultKey } = await uploadLogoImage({
        tenantId,
        logoId,
        bytes: result.bytes,
        mimeType: result.mimeType,
      })

      const newBalance = await db.transaction(async (tx) => {
        await tx
          .update(logos)
          .set({
            status: 'success',
            resultImageKey: resultKey,
            costUsd: tier.priceUsd ?? '0',
            creditsCharged: credits,
            updatedAt: new Date(),
          })
          .where(eq(logos.id, logoId))
        return applyKontenCredit(tx, {
          tenantId,
          delta: -credits,
          type: 'generation',
          refId: logoId,
          note: `Generasi logo (${resolution.toUpperCase()})`,
          createdBy: userId,
        })
      })

      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: LOGO_USAGE_FEATURE,
          provider: provider.providerType,
          model: provider.model,
          costUsd: tier.priceUsd ?? '0',
          latencyMs: Date.now() - startedAt,
          status: 'success',
        })
      } catch {
        // ignore
      }

      const resultUrl = await getLogoImageSignedUrl(resultKey)
      return { logoId, resultImageUrl: resultUrl, balance: newBalance }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal membuat logo.'
      await db
        .update(logos)
        .set({
          status: 'error',
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(logos.id, logoId))
      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: LOGO_USAGE_FEATURE,
          provider: provider.providerType,
          model: provider.model,
          latencyMs: Date.now() - startedAt,
          status: 'error',
          errorMessage: message,
        })
      } catch {
        // ignore
      }
      throw new Error(message)
    }
  })

export const getLogoDownloadUrl = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [row] = await db
      .select({ resultImageKey: logos.resultImageKey })
      .from(logos)
      .where(and(eq(logos.id, data.id), eq(logos.tenantId, tenantId)))
      .limit(1)
    if (!row?.resultImageKey) throw new Error('Logo belum siap.')
    const url = await getLogoImageDownloadSignedUrl(
      row.resultImageKey,
      `logo-${data.id}.png`,
    )
    return { url }
  })

export const deleteLogo = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [row] = await db
      .select({
        id: logos.id,
        resultImageKey: logos.resultImageKey,
      })
      .from(logos)
      .where(and(eq(logos.id, data.id), eq(logos.tenantId, tenantId)))
      .limit(1)
    if (!row) throw new Error('Logo tidak ditemukan.')
    if (row.resultImageKey) {
      await deleteLogoImageObject(row.resultImageKey).catch(() => undefined)
    }
    await db.delete(logos).where(eq(logos.id, data.id))
    return null
  })
