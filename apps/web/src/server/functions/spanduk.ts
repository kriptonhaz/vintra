import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  spanduks,
  spandukPromptFields,
  spandukPromptFieldOptions,
  spandukSettings,
  spandukSizePresets,
  kontenCreditAccounts,
  aiUsageLogs,
  type KontenSelectionSnapshot,
  type SpandukType,
} from '@vintra/db/schema'
import { and, eq, asc, desc } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import { applyKontenCredit } from './admin-konten-credits'
import {
  uploadSpandukAsset,
  getSpandukSignedUrl,
  getSpandukDownloadSignedUrl,
  deleteSpandukAsset,
  parseDataUrl,
} from '@/lib/s3-storage'
import { generateGeminiImage } from '@/lib/ai-image'
import { getDefaultImageProvider } from '@/server/lib/ai-image-provider'
import {
  composeSpanduk,
  pickGeminiAspectRatio,
} from '@/server/lib/spanduk-compositor'

const SPANDUK_USAGE_FEATURE = 'spanduk_image_gen'

/**
 * 1K preview cost. Cheap so users can iterate freely before paying
 * the full 4K commit price. Subtracted from the 4K cost when the
 * commit is generated from a preview (so total = direct cost).
 */
const PREVIEW_CREDIT_COST = 1

export type SpandukRow = {
  id: string
  status: string
  type: SpandukType
  widthCm: number
  heightCm: number
  prompt: string
  selections: KontenSelectionSnapshot[]
  pngImageUrl: string | null
  errorMessage: string | null
  headline: string | null
  subheadline: string | null
  createdAt: Date
}

export type SpandukSizeOption = {
  id: string
  type: SpandukType
  label: string
  widthCm: number
  heightCm: number
}

export type SpandukFieldDef = {
  key: string
  label: string
  helpText: string | null
  fieldType: 'select' | 'text'
  allowsCustom: boolean
  required: boolean
  options: { id: string; label: string }[]
}

// ── Status + config ──────────────────────────────────────────────────

export const getSpandukStatus = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { tenantId } = await requireAuth()
    const [account] = await db
      .select({ balance: kontenCreditAccounts.balance })
      .from(kontenCreditAccounts)
      .where(eq(kontenCreditAccounts.tenantId, tenantId))
      .limit(1)
    const provider = await getDefaultImageProvider()
    const [settings] = await db.select().from(spandukSettings).limit(1)
    const creditCost = settings?.defaultCreditCost ?? 6
    return {
      balance: account?.balance ?? 0,
      hasImageProvider: provider !== null,
      /** Cost of a direct 4K generation (no preview). */
      creditCost,
      /** Cost of a 1K preview. */
      previewCreditCost: PREVIEW_CREDIT_COST,
      /** Cost to commit a previously-paid preview to 4K. Total preview+commit
       *  equals a direct 4K generation. */
      commitFromPreviewCreditCost: Math.max(1, creditCost - PREVIEW_CREDIT_COST),
    }
  },
)

export const getSpandukConfig = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{
    fields: SpandukFieldDef[]
    sizes: SpandukSizeOption[]
  }> => {
    await requireAuth()
    const [fields, options, sizes] = await Promise.all([
      db
        .select()
        .from(spandukPromptFields)
        .where(eq(spandukPromptFields.isActive, true))
        .orderBy(asc(spandukPromptFields.sortOrder)),
      db
        .select()
        .from(spandukPromptFieldOptions)
        .where(eq(spandukPromptFieldOptions.isActive, true))
        .orderBy(asc(spandukPromptFieldOptions.sortOrder)),
      db
        .select()
        .from(spandukSizePresets)
        .where(eq(spandukSizePresets.isActive, true))
        .orderBy(
          asc(spandukSizePresets.type),
          asc(spandukSizePresets.sortOrder),
        ),
    ])
    const byField = new Map<string, { id: string; label: string }[]>()
    for (const o of options) {
      const item = { id: o.id, label: o.label }
      const list = byField.get(o.fieldId)
      if (list) list.push(item)
      else byField.set(o.fieldId, [item])
    }
    return {
      fields: fields.map(
        (f): SpandukFieldDef => ({
          key: f.key,
          label: f.label,
          helpText: f.helpText,
          fieldType: (f.fieldType as 'select' | 'text') ?? 'select',
          allowsCustom: f.allowsCustom,
          required: f.required,
          options: byField.get(f.id) ?? [],
        }),
      ),
      sizes: sizes.map((s) => ({
        id: s.id,
        type: s.type as SpandukType,
        label: s.label,
        widthCm: s.widthCm,
        heightCm: s.heightCm,
      })),
    }
  },
)

// ── Prompt assembly ──────────────────────────────────────────────────

const selectionInputSchema = z.object({
  fieldKey: z.string().max(40),
  optionId: z.string().uuid().optional(),
  customValue: z.string().max(400).optional(),
})

/**
 * Resolves the tenant's field selections into a snapshot suitable
 * for storage on the spanduk row. Replaces the old "assemble prompt
 * from template" flow — selections are now passed to the prompt
 * builder as styling hints, not as required template slots.
 */
async function resolveSelectionSnapshot(
  selections: z.infer<typeof selectionInputSchema>[],
): Promise<KontenSelectionSnapshot[]> {
  if (selections.length === 0) return []
  const [fields, options] = await Promise.all([
    db
      .select()
      .from(spandukPromptFields)
      .where(eq(spandukPromptFields.isActive, true))
      .orderBy(asc(spandukPromptFields.sortOrder)),
    db
      .select()
      .from(spandukPromptFieldOptions)
      .where(eq(spandukPromptFieldOptions.isActive, true)),
  ])
  const optionById = new Map(options.map((o) => [o.id, o]))
  const snapshot: KontenSelectionSnapshot[] = []
  for (const field of fields) {
    const sel = selections.find((s) => s.fieldKey === field.key)
    let displayValue = ''
    let isCustom = false
    if (field.fieldType === 'text') {
      const raw = (sel?.customValue ?? '').trim()
      if (raw) {
        displayValue = raw
        isCustom = true
      }
    } else if (sel?.optionId) {
      const opt = optionById.get(sel.optionId)
      if (opt && opt.fieldId === field.id) {
        displayValue = opt.label
      }
    } else if (sel?.customValue?.trim()) {
      if (!field.allowsCustom) {
        throw new Error(`${field.label} tidak menerima input bebas.`)
      }
      displayValue = sel.customValue.trim()
      isCustom = true
    }
    if (!displayValue) continue
    snapshot.push({
      fieldKey: field.key,
      fieldLabel: field.label,
      value: displayValue,
      isCustom,
    })
  }
  return snapshot
}

/**
 * Builds the prompt for Gemini to render a COMPLETE spanduk — text +
 * layout + design in one shot, no server-side compositing.
 *
 * Two design constraints worth calling out:
 *
 *   1. **Central 80% safe area.** Gemini emits at its closest native
 *      aspect ratio (21:9, 16:9, etc.) which rarely matches the
 *      tenant's exact print dimensions. We crop with `fit: 'cover'`
 *      afterwards, so anything in the top/bottom ~10% can vanish.
 *      The prompt forces critical content (headline + contact info)
 *      into the central band so the crop doesn't eat it.
 *
 *   2. **Text accuracy.** nano-banana is reliable for short words but
 *      occasionally autocorrects/swaps digits on long numbers. We
 *      hammer EXACT character preservation for phone + address since
 *      those are the most expensive to get wrong on a printed banner.
 */
function buildSpandukPrompt(input: {
  selections: KontenSelectionSnapshot[]
  text: {
    headline?: string
    subheadline?: string
    phone?: string
    address?: string
    ctaText?: string
  }
  hasSourceImages: boolean
}): string {
  const parts: string[] = []

  parts.push(
    'You are designing a COMPLETE Indonesian business print banner (spanduk). ' +
      'Generate the entire banner WITH all text rendered — typography is part of the design.',
  )

  parts.push(
    'SAFE AREA — CRITICAL: keep all important content (headline, subheadline, ' +
      'contact info, product images) within the CENTRAL 80% of the canvas. ' +
      'Leave the top 10% and bottom 10% as visual buffer (background, decoration, ' +
      'or empty) — these edges WILL be cropped during print sizing. Do NOT place ' +
      'text or any content the viewer needs to read in those margins.',
  )

  parts.push(
    'TEXT ACCURACY — CRITICAL: render every word, name, and digit EXACTLY as written below. ' +
      'Do NOT invent, paraphrase, omit, abbreviate, or autocorrect any text. ' +
      'Indonesian words must be spelled identically. Phone numbers and addresses MUST be ' +
      'character-for-character, digit-for-digit accurate — a single wrong digit makes the ' +
      'banner useless.',
  )

  parts.push(
    'Layout: a typical Indonesian warung/kios spanduk — the headline DOMINATES the canvas ' +
      '(huge, bold, eye-catching), secondary rows arranged below. Text must be readable across ' +
      'the street. Use bold high-contrast colors typical of Indonesian street signage ' +
      '(red, yellow, orange, green) on a light or branded background.',
  )

  if (input.text.headline) {
    parts.push(
      `Headline (LARGEST element, bold, occupies the upper-center of the safe area): "${input.text.headline}"`,
    )
  }
  if (input.text.subheadline) {
    parts.push(
      `Subheadline (medium size, below the headline, complementary color): "${input.text.subheadline}"`,
    )
  }
  const infoLines: string[] = []
  if (input.text.phone) infoLines.push(`WhatsApp: ${input.text.phone}`)
  if (input.text.address) infoLines.push(`Alamat: ${input.text.address}`)
  if (input.text.ctaText) infoLines.push(`CTA: ${input.text.ctaText}`)
  if (infoLines.length > 0) {
    parts.push(
      `Bottom info row (smaller text, positioned in the lower portion of the SAFE AREA ` +
        `— NOT at the canvas edge — neatly arranged):\n${infoLines
          .map((l) => `  - ${l}`)
          .join('\n')}`,
    )
  }

  if (input.selections.length > 0) {
    parts.push(
      `Style guidance:\n${input.selections
        .map((s) => `  - ${s.fieldLabel}: ${s.value}`)
        .join('\n')}`,
    )
  }

  if (input.hasSourceImages) {
    parts.push(
      'Product reference photos are attached — integrate them as the featured items in the design. ' +
        'PRESERVE their actual photographic appearance. Do NOT redraw, stylize, cartoonify, or ' +
        'replace them with illustrated versions.',
    )
  }

  parts.push(
    'Output: a single complete printable spanduk with all specified text rendered crisply. ' +
      'High resolution, sharp text edges, professional print quality. ' +
      'NO watermarks, NO signatures, NO additional logos or icons beyond what is requested.',
  )

  return parts.join('\n\n')
}

/** Random 32-bit seed for Gemini reproducibility. Stored on the row so
 *  a 1K preview's seed can be reused for the 4K commit. */
function makeSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

// ── List + delete ────────────────────────────────────────────────────

export const listSpanduks = createServerFn({ method: 'POST' }).handler(
  async (): Promise<SpandukRow[]> => {
    const { tenantId } = await requireAuth()
    const rows = await db
      .select()
      .from(spanduks)
      .where(eq(spanduks.tenantId, tenantId))
      .orderBy(desc(spanduks.createdAt))
      .limit(60)

    return Promise.all(
      rows.map(async (r): Promise<SpandukRow> => {
        const pngImageUrl = r.pngImageKey
          ? await getSpandukSignedUrl(r.pngImageKey)
          : null
        return {
          id: r.id,
          status: r.status,
          type: r.type as SpandukType,
          widthCm: r.widthCm,
          heightCm: r.heightCm,
          prompt: r.prompt,
          selections: r.selections ?? [],
          pngImageUrl,
          errorMessage: r.errorMessage,
          headline: r.headline,
          subheadline: r.subheadline,
          createdAt: r.createdAt,
        }
      }),
    )
  },
)

export const deleteSpanduk = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [row] = await db
      .select({
        id: spanduks.id,
        bgImageKey: spanduks.bgImageKey,
        pngImageKey: spanduks.pngImageKey,
        pdfImageKey: spanduks.pdfImageKey,
        sourceImageKeys: spanduks.sourceImageKeys,
      })
      .from(spanduks)
      .where(and(eq(spanduks.id, data.id), eq(spanduks.tenantId, tenantId)))
      .limit(1)
    if (!row) throw new Error('Spanduk tidak ditemukan.')

    const allKeys: string[] = []
    if (row.bgImageKey) allKeys.push(row.bgImageKey)
    if (row.pngImageKey) allKeys.push(row.pngImageKey)
    if (row.pdfImageKey) allKeys.push(row.pdfImageKey)
    if (row.sourceImageKeys) allKeys.push(...row.sourceImageKeys)
    for (const key of allKeys) {
      await deleteSpandukAsset(key).catch(() => undefined)
    }
    await db.delete(spanduks).where(eq(spanduks.id, data.id))
    return null
  })

// ── Download URLs ────────────────────────────────────────────────────

export const getSpandukDownloadUrl = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      format: z.enum(['png', 'pdf']).default('png'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    const [row] = await db
      .select({
        pngImageKey: spanduks.pngImageKey,
        pdfImageKey: spanduks.pdfImageKey,
      })
      .from(spanduks)
      .where(and(eq(spanduks.id, data.id), eq(spanduks.tenantId, tenantId)))
      .limit(1)
    if (!row) throw new Error('Spanduk tidak ditemukan.')
    const key = data.format === 'pdf' ? row.pdfImageKey : row.pngImageKey
    if (!key) throw new Error('Spanduk belum siap.')
    const url = await getSpandukDownloadSignedUrl(
      key,
      `spanduk-${data.id}.${data.format}`,
    )
    return { url }
  })

// ── Generate ─────────────────────────────────────────────────────────

const spandukTypeSchema = z.enum(['xbanner', 'spanduk'])

const MAX_SOURCE_IMAGES = 4
// 12 MB per data URL (base64-encoded, so ~9 MB binary). Client must
// resize before sending — this is a hard safety cap, not a target.
const MAX_SOURCE_DATA_URL_LEN = 12 * 1024 * 1024

export const generateSpanduk = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      type: spandukTypeSchema,
      sizePresetId: z.string().uuid().optional(),
      // When sizePresetId is absent these must be set (custom).
      customWidthCm: z.number().int().min(20).max(2000).optional(),
      customHeightCm: z.number().int().min(20).max(2000).optional(),
      selections: z.array(selectionInputSchema).default([]),
      headline: z.string().trim().max(120).optional(),
      subheadline: z.string().trim().max(160).optional(),
      phone: z.string().trim().max(40).optional(),
      address: z.string().trim().max(200).optional(),
      ctaText: z.string().trim().max(80).optional(),
      // 0..4 product reference photos as data URLs (client-side resized).
      sourceImageDataUrls: z
        .array(
          z
            .string()
            .startsWith('data:image/')
            .max(MAX_SOURCE_DATA_URL_LEN, 'Foto produk terlalu besar.'),
        )
        .max(MAX_SOURCE_IMAGES, `Maksimal ${MAX_SOURCE_IMAGES} foto produk.`)
        .default([]),
      /**
       * When true, generate at 1K for a cheap preview (no PDF, lower
       * credit cost). User reviews and either commits the preview to
       * 4K via `commitSpandukPreview` or discards and tries again.
       * When false, generate at 4K immediately (skip preview).
       */
      preview: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()

    // Resolve dimensions: either from preset or custom.
    let widthCm: number
    let heightCm: number
    let sizePresetId: string | null = null
    if (data.sizePresetId) {
      const [preset] = await db
        .select()
        .from(spandukSizePresets)
        .where(eq(spandukSizePresets.id, data.sizePresetId))
        .limit(1)
      if (!preset || !preset.isActive) {
        throw new Error('Ukuran spanduk tidak ditemukan.')
      }
      widthCm = preset.widthCm
      heightCm = preset.heightCm
      sizePresetId = preset.id
    } else {
      if (!data.customWidthCm || !data.customHeightCm) {
        throw new Error('Pilih ukuran standar atau isi ukuran custom.')
      }
      widthCm = data.customWidthCm
      heightCm = data.customHeightCm
    }

    if (!(data.headline ?? '').trim()) {
      throw new Error('Headline wajib diisi.')
    }

    const snapshot = await resolveSelectionSnapshot(data.selections)
    const prompt = buildSpandukPrompt({
      selections: snapshot,
      text: {
        headline: data.headline,
        subheadline: data.subheadline,
        phone: data.phone,
        address: data.address,
        ctaText: data.ctaText,
      },
      hasSourceImages: data.sourceImageDataUrls.length > 0,
    })

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

    // Read settings for cost. Previews cost a fixed PREVIEW_CREDIT_COST;
    // direct 4K commits use the configured default.
    const [settings] = await db.select().from(spandukSettings).limit(1)
    const directCost = settings?.defaultCreditCost ?? 6
    const creditsCost = data.preview ? PREVIEW_CREDIT_COST : directCost
    const resolution = data.preview ? '1k' : '4k'

    // Pre-flight balance check (shared Konten credit pool).
    const [account] = await db
      .select({ balance: kontenCreditAccounts.balance })
      .from(kontenCreditAccounts)
      .where(eq(kontenCreditAccounts.tenantId, tenantId))
      .limit(1)
    if ((account?.balance ?? 0) < creditsCost) {
      throw new Error(
        'Saldo kredit Konten tidak cukup. Beli paket kredit untuk lanjut generate.',
      )
    }

    // Random reproducibility seed — reused by commitSpandukPreview so
    // the 4K commit lands very close to the 1K preview the user OK'd.
    const seed = makeSeed()

    // Insert the spanduk row up-front (pending) so failures leave a trail.
    const [created] = await db
      .insert(spanduks)
      .values({
        tenantId,
        status: 'pending',
        type: data.type,
        sizePresetId,
        widthCm,
        heightCm,
        headline: data.headline || null,
        subheadline: data.subheadline || null,
        phone: data.phone || null,
        address: data.address || null,
        ctaText: data.ctaText || null,
        prompt,
        selections: snapshot,
        resolution,
        seed,
        providerConfigId: provider.configId,
        model: provider.model,
        createdBy: userId,
      })
      .returning({ id: spanduks.id })
    const spandukId = created!.id

    const startedAt = Date.now()
    try {
      // Decode + upload source product photos (if any) before calling
      // Gemini — they go to S3 for provenance AND are forwarded as
      // inline_data parts in the same request.
      const sourceBuffers: Array<{ bytes: Buffer; mimeType: string }> = []
      const sourceImageKeys: string[] = []
      for (let i = 0; i < data.sourceImageDataUrls.length; i++) {
        const dataUrl = data.sourceImageDataUrls[i]!
        const parsed = parseDataUrl(dataUrl)
        sourceBuffers.push(parsed)
        const { key } = await uploadSpandukAsset({
          tenantId,
          spandukId,
          variant: 'source',
          variantIndex: i,
          bytes: parsed.bytes,
          mimeType: parsed.mimeType,
        })
        sourceImageKeys.push(key)
      }

      // Call Gemini at the closest supported aspect ratio.
      const aspectRatio = pickGeminiAspectRatio(widthCm, heightCm)
      const result = await generateGeminiImage({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        prompt,
        imageSize: data.preview ? '1K' : '4K',
        aspectRatio,
        seed,
        sourceImages: sourceBuffers.length > 0 ? sourceBuffers : undefined,
      })

      // Persist the raw AI image bytes — useful for re-render / debugging.
      const { key: bgKey } = await uploadSpandukAsset({
        tenantId,
        spandukId,
        variant: 'bg',
        bytes: result.bytes,
        mimeType: result.mimeType,
      })

      // Resize to print dimensions. Previews skip the PDF (PNG-only is
      // fine for review — saves time + storage; PDF is only needed for
      // the printer).
      const composed = await composeSpanduk({
        imageBytes: result.bytes,
        widthCm,
        heightCm,
        buildPdf: !data.preview,
      })

      const { key: pngKey } = await uploadSpandukAsset({
        tenantId,
        spandukId,
        variant: 'png',
        bytes: composed.pngBytes,
        mimeType: 'image/png',
      })
      let pdfKey: string | null = null
      if (composed.pdfBytes) {
        const out = await uploadSpandukAsset({
          tenantId,
          spandukId,
          variant: 'pdf',
          bytes: composed.pdfBytes,
          mimeType: 'application/pdf',
        })
        pdfKey = out.key
      }

      const newBalance = await db.transaction(async (tx) => {
        await tx
          .update(spanduks)
          .set({
            status: 'success',
            bgImageKey: bgKey,
            pngImageKey: pngKey,
            pdfImageKey: pdfKey,
            sourceImageKeys:
              sourceImageKeys.length > 0 ? sourceImageKeys : null,
            creditsCharged: creditsCost,
            updatedAt: new Date(),
          })
          .where(eq(spanduks.id, spandukId))
        return applyKontenCredit(tx, {
          tenantId,
          delta: -creditsCost,
          type: 'generation',
          refId: spandukId,
          note: data.preview
            ? `Preview spanduk 1K (${widthCm}×${heightCm} cm)`
            : `Generasi spanduk (${widthCm}×${heightCm} cm)`,
          createdBy: userId,
        })
      })

      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: SPANDUK_USAGE_FEATURE,
          provider: provider.providerType,
          model: provider.model,
          latencyMs: Date.now() - startedAt,
          status: 'success',
        })
      } catch {
        // ignore
      }

      const pngUrl = await getSpandukSignedUrl(pngKey)
      return {
        spandukId,
        pngImageUrl: pngUrl,
        balance: newBalance,
        isPreview: data.preview,
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal membuat spanduk.'
      await db
        .update(spanduks)
        .set({
          status: 'error',
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(spanduks.id, spandukId))
      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: SPANDUK_USAGE_FEATURE,
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

/**
 * Commit a 1K preview to 4K. Reuses the preview's prompt + seed so the
 * 4K output lands close to what the user OK'd in preview. Charges the
 * remainder of the direct cost (so preview + commit = direct total).
 *
 * Source images: client re-sends the same data URLs used at preview
 * time. We re-upload them as `source-*` keys on the new commit row so
 * the commit is self-contained (preview row can be GC'd later without
 * breaking the commit).
 */
export const commitSpandukPreview = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      sourceImageDataUrls: z
        .array(
          z
            .string()
            .startsWith('data:image/')
            .max(MAX_SOURCE_DATA_URL_LEN, 'Foto produk terlalu besar.'),
        )
        .max(MAX_SOURCE_IMAGES, `Maksimal ${MAX_SOURCE_IMAGES} foto produk.`)
        .default([]),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()

    const [preview] = await db
      .select()
      .from(spanduks)
      .where(and(eq(spanduks.id, data.id), eq(spanduks.tenantId, tenantId)))
      .limit(1)
    if (!preview) throw new Error('Preview spanduk tidak ditemukan.')
    if (preview.status !== 'success') {
      throw new Error('Preview belum siap atau gagal — coba generate ulang.')
    }
    if (preview.resolution !== '1k') {
      throw new Error('Hanya hasil preview 1K yang dapat di-commit ke 4K.')
    }
    if (preview.parentSpandukId) {
      throw new Error('Spanduk ini sudah merupakan hasil commit, tidak bisa di-commit lagi.')
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

    const [settings] = await db.select().from(spandukSettings).limit(1)
    const directCost = settings?.defaultCreditCost ?? 6
    const commitCost = Math.max(1, directCost - PREVIEW_CREDIT_COST)

    const [account] = await db
      .select({ balance: kontenCreditAccounts.balance })
      .from(kontenCreditAccounts)
      .where(eq(kontenCreditAccounts.tenantId, tenantId))
      .limit(1)
    if ((account?.balance ?? 0) < commitCost) {
      throw new Error(
        'Saldo kredit Konten tidak cukup. Beli paket kredit untuk lanjut.',
      )
    }

    // Create the commit row up-front so failures leave a trail.
    const [created] = await db
      .insert(spanduks)
      .values({
        tenantId,
        status: 'pending',
        type: preview.type,
        sizePresetId: preview.sizePresetId,
        widthCm: preview.widthCm,
        heightCm: preview.heightCm,
        headline: preview.headline,
        subheadline: preview.subheadline,
        phone: preview.phone,
        address: preview.address,
        ctaText: preview.ctaText,
        prompt: preview.prompt,
        selections: preview.selections,
        resolution: '4k',
        seed: preview.seed,
        parentSpandukId: preview.id,
        providerConfigId: provider.configId,
        model: provider.model,
        createdBy: userId,
      })
      .returning({ id: spanduks.id })
    const spandukId = created!.id

    const startedAt = Date.now()
    try {
      const sourceBuffers: Array<{ bytes: Buffer; mimeType: string }> = []
      const sourceImageKeys: string[] = []
      // Two paths feed source images:
      //   - Generate page commit: client passes data URLs (still in form state)
      //   - Gallery commit: client passes none; we fetch from S3 using the
      //     preview row's stored keys so the user doesn't have to re-upload
      //     the originals just to commit later.
      if (data.sourceImageDataUrls.length > 0) {
        for (let i = 0; i < data.sourceImageDataUrls.length; i++) {
          const dataUrl = data.sourceImageDataUrls[i]!
          const parsed = parseDataUrl(dataUrl)
          sourceBuffers.push(parsed)
          const { key } = await uploadSpandukAsset({
            tenantId,
            spandukId,
            variant: 'source',
            variantIndex: i,
            bytes: parsed.bytes,
            mimeType: parsed.mimeType,
          })
          sourceImageKeys.push(key)
        }
      } else if (preview.sourceImageKeys && preview.sourceImageKeys.length > 0) {
        for (let i = 0; i < preview.sourceImageKeys.length; i++) {
          const previewKey = preview.sourceImageKeys[i]!
          const signedUrl = await getSpandukSignedUrl(previewKey)
          const res = await fetch(signedUrl)
          if (!res.ok) {
            throw new Error(
              `Gagal mengambil foto sumber dari preview (HTTP ${res.status}).`,
            )
          }
          const bytes = Buffer.from(await res.arrayBuffer())
          const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
          sourceBuffers.push({ bytes, mimeType })
          // Re-upload under the commit row's key namespace so each row is
          // self-contained — deleting the preview later won't break this
          // commit's S3 references.
          const { key } = await uploadSpandukAsset({
            tenantId,
            spandukId,
            variant: 'source',
            variantIndex: i,
            bytes,
            mimeType,
          })
          sourceImageKeys.push(key)
        }
      }

      const aspectRatio = pickGeminiAspectRatio(preview.widthCm, preview.heightCm)
      const result = await generateGeminiImage({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        prompt: preview.prompt,
        imageSize: '4K',
        aspectRatio,
        seed: preview.seed ?? undefined,
        sourceImages: sourceBuffers.length > 0 ? sourceBuffers : undefined,
      })

      const { key: bgKey } = await uploadSpandukAsset({
        tenantId,
        spandukId,
        variant: 'bg',
        bytes: result.bytes,
        mimeType: result.mimeType,
      })

      const composed = await composeSpanduk({
        imageBytes: result.bytes,
        widthCm: preview.widthCm,
        heightCm: preview.heightCm,
        buildPdf: true,
      })

      const [{ key: pngKey }, { key: pdfKey }] = await Promise.all([
        uploadSpandukAsset({
          tenantId,
          spandukId,
          variant: 'png',
          bytes: composed.pngBytes,
          mimeType: 'image/png',
        }),
        uploadSpandukAsset({
          tenantId,
          spandukId,
          variant: 'pdf',
          bytes: composed.pdfBytes!,
          mimeType: 'application/pdf',
        }),
      ])

      const newBalance = await db.transaction(async (tx) => {
        await tx
          .update(spanduks)
          .set({
            status: 'success',
            bgImageKey: bgKey,
            pngImageKey: pngKey,
            pdfImageKey: pdfKey,
            sourceImageKeys:
              sourceImageKeys.length > 0 ? sourceImageKeys : null,
            creditsCharged: commitCost,
            updatedAt: new Date(),
          })
          .where(eq(spanduks.id, spandukId))
        return applyKontenCredit(tx, {
          tenantId,
          delta: -commitCost,
          type: 'generation',
          refId: spandukId,
          note: `Commit spanduk 4K (${preview.widthCm}×${preview.heightCm} cm)`,
          createdBy: userId,
        })
      })

      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: SPANDUK_USAGE_FEATURE,
          provider: provider.providerType,
          model: provider.model,
          latencyMs: Date.now() - startedAt,
          status: 'success',
        })
      } catch {
        // ignore
      }

      const pngUrl = await getSpandukSignedUrl(pngKey)
      return {
        spandukId,
        pngImageUrl: pngUrl,
        balance: newBalance,
        isPreview: false as const,
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal commit spanduk.'
      await db
        .update(spanduks)
        .set({
          status: 'error',
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(spanduks.id, spandukId))
      try {
        await db.insert(aiUsageLogs).values({
          tenantId,
          feature: SPANDUK_USAGE_FEATURE,
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
