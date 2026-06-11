import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  kontenImages,
  logos,
  spanduks,
  type KontenSelectionSnapshot,
} from '@vintra/db/schema'
import { and, eq, desc, sql, isNotNull } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import {
  getKontenImageSignedUrl,
  getKontenImageDownloadSignedUrl,
  deleteKontenImage as deleteKontenImageObject,
  getLogoImageSignedUrl,
  getLogoImageDownloadSignedUrl,
  deleteLogoImage as deleteLogoImageObject,
  getSpandukSignedUrl,
  getSpandukDownloadSignedUrl,
  deleteSpandukAsset,
} from '@/lib/s3-storage'

const STUDIO_LIMIT = 60

export type StudioGenerationKind = 'konten' | 'logo' | 'spanduk'

/**
 * A row from the combined Studio gallery — covers both photo-enhancement
 * generations (kind = 'konten') and logo generations (kind = 'logo').
 * Konten rows can carry a separate source image (the original product
 * photo); Logo rows are text-to-image so `sourceImageUrl` is always null.
 */
export type StudioRow = {
  id: string
  kind: StudioGenerationKind
  status: string
  prompt: string
  promptMode: string | null
  selections: KontenSelectionSnapshot[]
  resolution: string | null
  resultImageUrl: string | null
  sourceImageUrl: string | null
  errorMessage: string | null
  /** Credits debited for this generation. NULL for legacy rows. */
  creditsCharged: number | null
  /**
   * Spanduk-only flags. `isPreview` is true for 1K preview rows; the
   * UI surfaces a "Commit to 4K" CTA on them. `hasCommit` indicates
   * the preview has already been committed to a 4K row (so the CTA
   * can be hidden). Both default false for non-spanduk kinds.
   */
  isPreview: boolean
  hasCommit: boolean
  createdAt: Date
}

export const listStudioGenerations = createServerFn({
  method: 'POST',
}).handler(async (): Promise<StudioRow[]> => {
  const { tenantId } = await requireAuth()

  // Map of preview spanduk id → true when at least one 4K commit row
  // points back at it. Used to hide the "Setujui & Cetak 4K" CTA on
  // previews that have already been committed.
  const committedPreviewRows = await db
    .select({ parentId: spanduks.parentSpandukId })
    .from(spanduks)
    .where(
      and(
        eq(spanduks.tenantId, tenantId),
        isNotNull(spanduks.parentSpandukId),
      ),
    )
  const committedPreviewIds = new Set(
    committedPreviewRows
      .map((r) => r.parentId)
      .filter((id): id is string => !!id),
  )

  // Fetch each kind up to the cap, then merge + sort by createdAt so the
  // newest of any kind always appears first.
  const [kontenRows, logoRows, spandukRows] = await Promise.all([
    db
      .select()
      .from(kontenImages)
      .where(eq(kontenImages.tenantId, tenantId))
      .orderBy(desc(kontenImages.createdAt))
      .limit(STUDIO_LIMIT),
    db
      .select()
      .from(logos)
      .where(eq(logos.tenantId, tenantId))
      .orderBy(desc(logos.createdAt))
      .limit(STUDIO_LIMIT),
    db
      .select()
      .from(spanduks)
      .where(eq(spanduks.tenantId, tenantId))
      .orderBy(desc(spanduks.createdAt))
      .limit(STUDIO_LIMIT),
  ])

  type Pending = {
    row: StudioRow
    resultKey: string | null
    sourceKey: string | null
  }
  const pending: Pending[] = []

  for (const r of kontenRows) {
    pending.push({
      row: {
        id: r.id,
        kind: 'konten',
        status: r.status,
        prompt: r.prompt,
        promptMode: r.promptMode,
        selections: r.selections ?? [],
        resolution: r.resolution,
        resultImageUrl: null,
        sourceImageUrl: null,
        errorMessage: r.errorMessage,
        creditsCharged: r.creditsCharged ?? null,
        isPreview: false,
        hasCommit: false,
        createdAt: r.createdAt,
      },
      resultKey: r.resultImageKey,
      sourceKey: r.sourceImageKey,
    })
  }
  for (const r of logoRows) {
    pending.push({
      row: {
        id: r.id,
        kind: 'logo',
        status: r.status,
        prompt: r.prompt,
        promptMode: null,
        selections: r.selections ?? [],
        resolution: r.resolution,
        resultImageUrl: null,
        sourceImageUrl: null,
        errorMessage: r.errorMessage,
        creditsCharged: r.creditsCharged ?? null,
        isPreview: false,
        hasCommit: false,
        createdAt: r.createdAt,
      },
      resultKey: r.resultImageKey,
      sourceKey: null,
    })
  }
  for (const r of spandukRows) {
    const isPreview = r.resolution === '1k'
    pending.push({
      row: {
        id: r.id,
        kind: 'spanduk',
        status: r.status,
        prompt: r.prompt,
        promptMode: null,
        selections: r.selections ?? [],
        resolution: r.resolution,
        resultImageUrl: null,
        sourceImageUrl: null,
        errorMessage: r.errorMessage,
        creditsCharged: r.creditsCharged ?? null,
        isPreview,
        hasCommit: isPreview && committedPreviewIds.has(r.id),
        createdAt: r.createdAt,
      },
      resultKey: r.pngImageKey,
      sourceKey: null,
    })
  }

  pending.sort(
    (a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime(),
  )
  const top = pending.slice(0, STUDIO_LIMIT)

  // Sign every URL in parallel. Each kind has its own signer.
  const signerFor = (kind: StudioGenerationKind) =>
    kind === 'konten'
      ? getKontenImageSignedUrl
      : kind === 'logo'
        ? getLogoImageSignedUrl
        : getSpandukSignedUrl
  await Promise.all(
    top.map(async (p) => {
      const sign = signerFor(p.row.kind)
      if (p.resultKey) p.row.resultImageUrl = await sign(p.resultKey)
      if (p.sourceKey)
        p.row.sourceImageUrl = await getKontenImageSignedUrl(p.sourceKey)
    }),
  )

  return top.map((p) => p.row)
})

export const getStudioDownloadUrl = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(['konten', 'logo', 'spanduk']),
      format: z.enum(['png', 'pdf']).default('png'),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    if (data.kind === 'konten') {
      const [row] = await db
        .select({ resultImageKey: kontenImages.resultImageKey })
        .from(kontenImages)
        .where(
          and(
            eq(kontenImages.id, data.id),
            eq(kontenImages.tenantId, tenantId),
          ),
        )
        .limit(1)
      if (!row?.resultImageKey) throw new Error('Gambar belum siap.')
      const url = await getKontenImageDownloadSignedUrl(
        row.resultImageKey,
        `konten-${data.id}.png`,
      )
      return { url }
    }
    if (data.kind === 'logo') {
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
    }
    // spanduk
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

export const deleteStudioGeneration = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(['konten', 'logo', 'spanduk']),
    }),
  )
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()
    if (data.kind === 'konten') {
      const [row] = await db
        .select({
          id: kontenImages.id,
          sourceImageKey: kontenImages.sourceImageKey,
          resultImageKey: kontenImages.resultImageKey,
          personImageKey: kontenImages.personImageKey,
        })
        .from(kontenImages)
        .where(
          and(
            eq(kontenImages.id, data.id),
            eq(kontenImages.tenantId, tenantId),
          ),
        )
        .limit(1)
      if (!row) throw new Error('Konten tidak ditemukan.')
      await Promise.all(
        [row.sourceImageKey, row.resultImageKey, row.personImageKey]
          .filter((k): k is string => !!k)
          .map((k) => deleteKontenImageObject(k).catch(() => undefined)),
      )
      await db.delete(kontenImages).where(eq(kontenImages.id, data.id))
      return null
    }
    if (data.kind === 'logo') {
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
    }
    // spanduk
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
    await Promise.all(
      allKeys.map((k) => deleteSpandukAsset(k).catch(() => undefined)),
    )
    await db.delete(spanduks).where(eq(spanduks.id, data.id))
    return null
  })
