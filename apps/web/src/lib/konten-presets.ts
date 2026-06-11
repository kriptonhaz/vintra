/**
 * Konten Promosi resolution tiers. Shared between the generate UI and the
 * server function. Enhancement presets are no longer hardcoded here —
 * they're admin-managed prompt fields stored in the database.
 */

// ── Resolution tiers ──────────────────────────────────────────────────
// Nano Banana charges more for higher resolutions, so credit cost scales.

export const KONTEN_RESOLUTIONS = ['1k', '2k', '4k'] as const
export type KontenResolution = (typeof KONTEN_RESOLUTIONS)[number]

export interface ResolutionTierPricing {
  credits: number
  priceUsd: string | null
}

/** Fallback when an image capability has no imageResolutionPricing set. */
export const DEFAULT_RESOLUTION_PRICING: Record<
  KontenResolution,
  ResolutionTierPricing
> = {
  '1k': { credits: 1, priceUsd: null },
  '2k': { credits: 2, priceUsd: null },
  '4k': { credits: 4, priceUsd: null },
}

/** Maps a tier key to the value Gemini's imageConfig.imageSize expects. */
export const GEMINI_IMAGE_SIZE: Record<KontenResolution, string> = {
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
}
