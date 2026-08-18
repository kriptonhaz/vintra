import { db } from '@vintra/db'
import { aiProviderConfigs, aiProviderCapabilities } from '@vintra/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Server-only helper for Juragan AI (and any future text-completion feature).
 *
 * Mirrors `ai-image-provider.ts` — see the comment there for why this must
 * live in `server/lib` and never be exported from a server-fn file: doing so
 * defeats TanStack Start's client-bundle stripping and leaks postgres into the
 * browser build.
 */

export interface TextProvider {
  configId: string
  /** 'openai' | 'gemini'. DeepSeek rides the openai adapter via baseUrl. */
  providerType: string
  model: string
  baseUrl: string
  apiKey: string
  inputPricePer1MUsd: string | null
  outputPricePer1MUsd: string | null
}

/**
 * Resolves the platform's default text-completion provider — the config whose
 * `text` capability is the active default. Returns null when none is
 * configured, so callers can fail with a clear message rather than a crash.
 */
export async function getDefaultTextProvider(): Promise<TextProvider | null> {
  const [row] = await db
    .select({
      configId: aiProviderConfigs.id,
      providerType: aiProviderConfigs.providerType,
      model: aiProviderConfigs.model,
      baseUrl: aiProviderConfigs.baseUrl,
      apiKey: aiProviderConfigs.apiKey,
      inputPricePer1MUsd: aiProviderCapabilities.inputPricePer1MUsd,
      outputPricePer1MUsd: aiProviderCapabilities.outputPricePer1MUsd,
    })
    .from(aiProviderCapabilities)
    .innerJoin(
      aiProviderConfigs,
      eq(aiProviderConfigs.id, aiProviderCapabilities.configId),
    )
    .where(
      and(
        eq(aiProviderCapabilities.capability, 'text'),
        eq(aiProviderCapabilities.isDefault, true),
        eq(aiProviderCapabilities.isActive, true),
        eq(aiProviderConfigs.isActive, true),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * USD cost of one completion, at the capability's configured per-1M rates.
 *
 * Returned as a fixed-6 string because it is written straight into a
 * `numeric` column — going through a float would round differently on
 * different rows for no reason.
 */
export function computeTextCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: Pick<TextProvider, 'inputPricePer1MUsd' | 'outputPricePer1MUsd'>,
): string {
  const inRate = Number(pricing.inputPricePer1MUsd ?? 0)
  const outRate = Number(pricing.outputPricePer1MUsd ?? 0)
  return ((inputTokens * inRate + outputTokens * outRate) / 1_000_000).toFixed(6)
}
