import { db } from '@vintra/db'
import {
  aiProviderConfigs,
  aiProviderCapabilities,
  type ImageResolutionPricing,
} from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  KONTEN_RESOLUTIONS,
  type KontenResolution,
  type ResolutionTierPricing,
  DEFAULT_RESOLUTION_PRICING,
} from '@/lib/konten-presets'

/**
 * Server-only helpers shared by the Konten and Logo generation flows.
 *
 * This file is imported only by other server-function files (`konten.ts`,
 * `logo.ts`) and is never reachable from a client route — TanStack Start's
 * vite plugin emits a client RPC stub for files that *only* export
 * `createServerFn()` results, so the `db` import here never lands in the
 * browser bundle. Exporting these as plain functions from a server-fn
 * file (which is how this code was originally factored) defeats that
 * stripping and leaks postgres into the client build.
 */

/**
 * Resolves the platform's default image-generation provider — the config
 * whose `image` capability is the active default. Returns null when no
 * image provider is configured.
 */
export async function getDefaultImageProvider() {
  const [row] = await db
    .select({
      configId: aiProviderConfigs.id,
      providerType: aiProviderConfigs.providerType,
      model: aiProviderConfigs.model,
      baseUrl: aiProviderConfigs.baseUrl,
      apiKey: aiProviderConfigs.apiKey,
      imageResolutionPricing: aiProviderCapabilities.imageResolutionPricing,
    })
    .from(aiProviderCapabilities)
    .innerJoin(
      aiProviderConfigs,
      eq(aiProviderConfigs.id, aiProviderCapabilities.configId),
    )
    .where(
      and(
        eq(aiProviderCapabilities.capability, 'image'),
        eq(aiProviderCapabilities.isDefault, true),
        eq(aiProviderCapabilities.isActive, true),
        eq(aiProviderConfigs.isActive, true),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Merges an image capability's configured per-resolution pricing over the
 * platform defaults, so every tier always resolves to a usable value.
 */
export function resolvePricing(
  configured: ImageResolutionPricing | null,
): Record<KontenResolution, ResolutionTierPricing> {
  const out = {} as Record<KontenResolution, ResolutionTierPricing>
  for (const r of KONTEN_RESOLUTIONS) {
    out[r] = configured?.[r] ?? DEFAULT_RESOLUTION_PRICING[r]
  }
  return out
}
