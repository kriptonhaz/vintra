import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  kontenImages,
  kontenCreditAccounts,
  kontenCreditLedger,
  kontenPromptFields,
  kontenPromptFieldOptions,
  kontenSettings,
  aiUsageLogs,
  type KontenSelectionSnapshot,
  type KontenOptionTextInput,
} from '@vintra/db/schema'
import { and, eq, asc, desc } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import { applyKontenCredit } from './admin-konten-credits'
import {
  uploadKontenImage,
  getKontenImageSignedUrl,
  getKontenImageDownloadSignedUrl,
  deleteKontenImage as deleteKontenImageObject,
  parseDataUrl,
} from '@/lib/s3-storage'
import { generateGeminiImage } from '@/lib/ai-image'
import { KONTEN_RESOLUTIONS, GEMINI_IMAGE_SIZE } from '@/lib/konten-presets'
import { getDefaultImageProvider, resolvePricing } from '@/server/lib/ai-image-provider'

const KONTEN_USAGE_FEATURE = 'konten_image_gen'

export type KontenImageRow = {
  id: string
  status: string
  prompt: string
  promptMode: string
  selections: KontenSelectionSnapshot[]
  resolution: string | null
  productId: string | null
  sourceImageUrl: string | null
  resultImageUrl: string | null
  errorMessage: string | null
  createdAt: Date
}

export type KontenPromptField = {
  key: string
  label: string
  helpText: string | null
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
  customValue: z.string().max(200).optional(),
  /** Values typed into the option's free-text inputs, keyed by input key. */
  textInputs: z.record(z.string(), z.string().max(400)).optional(),
})

/**
 * Builds the guided-mode prompt from the tenant's field selections plus the
 * admin-configured template, and returns a frozen snapshot of the choices.
 * Throws when a required field has no selection.
 */
async function assembleGuidedPrompt(
  selections: z.infer<typeof selectionInputSchema>[],
): Promise<{ prompt: string; snapshot: KontenSelectionSnapshot[] }> {
  const [fields, options, settingsRows] = await Promise.all([
    db
      .select()
      .from(kontenPromptFields)
      .where(eq(kontenPromptFields.isActive, true))
      .orderBy(asc(kontenPromptFields.sortOrder)),
    db
      .select()
      .from(kontenPromptFieldOptions)
      .where(eq(kontenPromptFieldOptions.isActive, true)),
    db.select().from(kontenSettings).limit(1),
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

    if (sel?.optionId) {
      const opt = optionById.get(sel.optionId)
      if (opt && opt.fieldId === field.id) {
        fragment = opt.promptFragment
        displayValue = opt.label

        // Substitute the option's text-input values into the fragment
        // (e.g. {headline}, {subheadline}, {cta} for "Pakai teks saya"),
        // and snapshot the filled values for the gallery.
        if (opt.textInputs && opt.textInputs.length > 0 && sel.textInputs) {
          const snapshot: NonNullable<typeof textInputsSnapshot> = []
          for (const def of opt.textInputs) {
            const raw = (sel.textInputs[def.key] ?? '').trim()
            fragment = fragment.split(`{${def.key}}`).join(raw)
            if (raw) {
              snapshot.push({ key: def.key, label: def.label, value: raw })
            }
          }
          if (snapshot.length > 0) textInputsSnapshot = snapshot
          // Drop any lines whose only payload was an empty user input —
          // a `Headline: ""` line in the prompt invites the model to render
          // empty quotes; cleaner to strip it entirely.
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
      if (field.required) throw new Error(`${field.label} wajib dipilih.`)
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
    // Drop placeholders for fields that weren't selected.
    prompt = prompt.replace(/\{[a-z0-9_]+\}/gi, '')
  } else {
    prompt = [...fragmentByKey.values()].join('\n\n')
  }
  prompt = prompt
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!prompt) throw new Error('Pilih minimal satu opsi penyempurnaan.')
  return { prompt, snapshot }
}

export type KontenLedgerEntry = {
  id: string
  delta: number
  type: string
  note: string | null
  createdAt: Date
}

/** Tenant's own ledger — last 50 entries, newest first. Used by the
 *  /studio/billing page so the owner can see top-ups + spends. */
export const getMyKontenLedger = createServerFn({ method: 'POST' }).handler(
  async (): Promise<KontenLedgerEntry[]> => {
    const { tenantId } = await requireAuth()
    return db
      .select({
        id: kontenCreditLedger.id,
        delta: kontenCreditLedger.delta,
        type: kontenCreditLedger.type,
        note: kontenCreditLedger.note,
        createdAt: kontenCreditLedger.createdAt,
      })
      .from(kontenCreditLedger)
      .where(eq(kontenCreditLedger.tenantId, tenantId))
      .orderBy(desc(kontenCreditLedger.createdAt))
      .limit(50)
  },
)

/** Tenant-facing credit balance + whether image generation is available. */
export const getKontenStatus = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { tenantId } = await requireAuth()
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

/** Tenant-facing prompt-field config for the guided generate form. */
export const getKontenPromptConfig = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ fields: KontenPromptField[] }> => {
    await requireAuth()
    const [fields, options] = await Promise.all([
      db
        .select()
        .from(kontenPromptFields)
        .where(eq(kontenPromptFields.isActive, true))
        .orderBy(asc(kontenPromptFields.sortOrder)),
      db
        .select()
        .from(kontenPromptFieldOptions)
        .where(eq(kontenPromptFieldOptions.isActive, true))
        .orderBy(asc(kontenPromptFieldOptions.sortOrder)),
    ])
    const byField = new Map<string, KontenPromptField['options']>()
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
        (f): KontenPromptField => ({
          key: f.key,
          label: f.label,
          helpText: f.helpText,
          allowsCustom: f.allowsCustom,
          required: f.required,
          options: byField.get(f.id) ?? [],
        }),
      ),
    }
  },
)

export const listKontenImages = createServerFn({ method: 'POST' }).handler(
  async (): Promise<KontenImageRow[]> => {
    const { tenantId } = await requireAuth()
    const rows = await db
      .select()
      .from(kontenImages)
      .where(eq(kontenImages.tenantId, tenantId))
      .orderBy(desc(kontenImages.createdAt))
      .limit(60)

    return Promise.all(
      rows.map(async (r): Promise<KontenImageRow> => {
        const [sourceImageUrl, resultImageUrl] = await Promise.all([
          r.sourceImageKey
            ? getKontenImageSignedUrl(r.sourceImageKey)
            : Promise.resolve(null),
          r.resultImageKey
            ? getKontenImageSignedUrl(r.resultImageKey)
            : Promise.resolve(null),
        ])
        return {
          id: r.id,
          status: r.status,
          prompt: r.prompt,
          promptMode: r.promptMode,
          selections: r.selections ?? [],
          resolution: r.resolution,
          productId: r.productId,
          sourceImageUrl,
          resultImageUrl,
          errorMessage: r.errorMessage,
          createdAt: r.createdAt,
        }
      }),
    )
  },
)

export const generateKontenImage = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      sourceImageDataUrl: z.string().min(1, 'Foto produk wajib diunggah'),
      /**
       * Optional second source image — the face/silhouette the tenant
       * wants to feature alongside the product. When present, both
       * images are forwarded to Gemini as inline_data parts and the
       * prompt is prepended with an instruction telling the model
       * which image is which.
       */
      personImageDataUrl: z
        .string()
        .startsWith('data:image/')
        .optional(),
      mode: z.enum(['guided', 'custom']).default('guided'),
      selections: z.array(selectionInputSchema).default([]),
      customPrompt: z.string().max(2000).optional(),
      productId: z.string().uuid().optional(),
      resolution: z.enum(KONTEN_RESOLUTIONS).default('1k'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()
    const resolution = data.resolution

    // Resolve the prompt — guided (template + selections) or custom (raw).
    let finalPrompt: string
    let snapshot: KontenSelectionSnapshot[] = []
    if (data.mode === 'custom') {
      finalPrompt = (data.customPrompt ?? '').trim()
      if (!finalPrompt) throw new Error('Tuliskan instruksi prompt-mu.')
    } else {
      const built = await assembleGuidedPrompt(data.selections)
      finalPrompt = built.prompt
      snapshot = built.snapshot
    }

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

    // Credit cost + USD price scale with the chosen resolution.
    const tier = resolvePricing(provider.imageResolutionPricing)[resolution]
    const credits = tier.credits

    // Pre-flight credit check — avoids paying for a generation the tenant
    // can't afford. The transactional deduction below is the real guard.
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

    const source = parseDataUrl(data.sourceImageDataUrl)
    const person = data.personImageDataUrl
      ? parseDataUrl(data.personImageDataUrl)
      : null

    // When a person photo is attached, prepend a multi-image instruction
    // so Gemini knows which inline_data part is the product vs the
    // person. Without this the model can swap their roles (stylizes
    // the person, drops the product) since it sees two equal images.
    if (person) {
      finalPrompt = [
        'IMPORTANT — MULTI-IMAGE INPUT: The FIRST attached image is the PRODUCT. Preserve its exact shape, color, label, and packaging — do not redraw, restyle, or replace it.',
        'The SECOND attached image is the PERSON to feature in the scene. Preserve their likeness, skin tone, hair, and clothing. Integrate them naturally with the product following the style instructions below.',
        '',
        finalPrompt,
      ].join('\n')
    }

    // Record the attempt up front so failures are visible in the gallery.
    const [created] = await db
      .insert(kontenImages)
      .values({
        tenantId,
        status: 'pending',
        prompt: finalPrompt,
        promptMode: data.mode,
        selections: snapshot,
        resolution,
        productId: data.productId ?? null,
        providerConfigId: provider.configId,
        model: provider.model,
        createdBy: userId,
      })
      .returning({ id: kontenImages.id })
    const imageId = created!.id

    const startedAt = Date.now()
    try {
      const { key: sourceKey } = await uploadKontenImage({
        tenantId,
        imageId,
        variant: 'source',
        bytes: source.bytes,
        mimeType: source.mimeType,
      })
      let personKey: string | null = null
      if (person) {
        const out = await uploadKontenImage({
          tenantId,
          imageId,
          variant: 'person',
          bytes: person.bytes,
          mimeType: person.mimeType,
        })
        personKey = out.key
      }
      await db
        .update(kontenImages)
        .set({
          sourceImageKey: sourceKey,
          personImageKey: personKey,
          updatedAt: new Date(),
        })
        .where(eq(kontenImages.id, imageId))

      const result = await generateGeminiImage({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        prompt: finalPrompt,
        // Send both images as a parts array — Gemini's adapter forwards
        // sourceImages[] as inline_data parts in order, matching the
        // FIRST/SECOND references in the multi-image prompt above.
        sourceImage: person ? undefined : source,
        sourceImages: person ? [source, person] : undefined,
        imageSize: GEMINI_IMAGE_SIZE[resolution],
      })

      const { key: resultKey } = await uploadKontenImage({
        tenantId,
        imageId,
        variant: 'result',
        bytes: result.bytes,
        mimeType: result.mimeType,
      })

      // Mark success + deduct credit atomically. applyKontenCredit throws
      // (rolling back) if a concurrent generation drained the balance.
      const newBalance = await db.transaction(async (tx) => {
        await tx
          .update(kontenImages)
          .set({
            status: 'success',
            resultImageKey: resultKey,
            costUsd: tier.priceUsd ?? '0',
            creditsCharged: credits,
            updatedAt: new Date(),
          })
          .where(eq(kontenImages.id, imageId))
        return applyKontenCredit(tx, {
          tenantId,
          delta: -credits,
          type: 'generation',
          refId: imageId,
          note: `Generasi gambar Konten Promosi (${resolution.toUpperCase()})`,
          createdBy: userId,
        })
      })

      // Best-effort usage log — never fails the generation.
      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: KONTEN_USAGE_FEATURE,
          provider: provider.providerType,
          model: provider.model,
          costUsd: tier.priceUsd ?? '0',
          latencyMs: Date.now() - startedAt,
          status: 'success',
        })
      } catch {
        // ignore — logging must not break a successful generation
      }

      const resultUrl = await getKontenImageSignedUrl(resultKey)
      return { imageId, resultImageUrl: resultUrl, balance: newBalance }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal membuat gambar.'
      await db
        .update(kontenImages)
        .set({
          status: 'error',
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(kontenImages.id, imageId))
      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: KONTEN_USAGE_FEATURE,
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

/** Returns a short-lived signed URL that forces a browser download (the
 *  S3 GET carries Content-Disposition: attachment). Use for the "Unduh"
 *  action — reliable across iOS Safari, Brave, and desktop. */
export const getKontenImageDownloadUrl = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      variant: z.enum(['result', 'source']).default('result'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [row] = await db
      .select({
        resultImageKey: kontenImages.resultImageKey,
        sourceImageKey: kontenImages.sourceImageKey,
      })
      .from(kontenImages)
      .where(
        and(eq(kontenImages.id, data.id), eq(kontenImages.tenantId, tenantId)),
      )
      .limit(1)
    if (!row) throw new Error('Konten tidak ditemukan.')
    const key =
      data.variant === 'source' ? row.sourceImageKey : row.resultImageKey
    if (!key) throw new Error('Gambar belum siap.')
    const url = await getKontenImageDownloadSignedUrl(
      key,
      `konten-${data.id}.png`,
    )
    return { url }
  })

export const deleteKontenImage = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [row] = await db
      .select({
        id: kontenImages.id,
        sourceImageKey: kontenImages.sourceImageKey,
        resultImageKey: kontenImages.resultImageKey,
      })
      .from(kontenImages)
      .where(
        and(eq(kontenImages.id, data.id), eq(kontenImages.tenantId, tenantId)),
      )
      .limit(1)
    if (!row) throw new Error('Konten tidak ditemukan.')

    await Promise.all(
      [row.sourceImageKey, row.resultImageKey]
        .filter((k): k is string => !!k)
        .map((k) => deleteKontenImageObject(k).catch(() => undefined)),
    )
    await db.delete(kontenImages).where(eq(kontenImages.id, data.id))
    return null
  })
