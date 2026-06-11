/**
 * Minimal image-generation client. Server-only — call sites pass the
 * provider connection (base URL + API key + model) resolved from the
 * default `image`-capability ai_provider_configs row.
 *
 * Currently supports Google Gemini image models (e.g. Nano Banana). The
 * call is image-to-image: a source product photo plus a text instruction
 * in, an enhanced image out.
 */

export interface GenerateImageInput {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  /** Optional — omit for pure text-to-image (e.g. logo generation). */
  sourceImage?: { bytes: Buffer; mimeType: string }
  /**
   * Optional list of additional reference images attached alongside
   * `sourceImage`. Used by Spanduk where the tenant may upload several
   * product photos for the AI to compose into the banner.
   */
  sourceImages?: Array<{ bytes: Buffer; mimeType: string }>
  /** Gemini imageConfig.imageSize value, e.g. "1K" | "2K" | "4K". */
  imageSize?: string
  /** Gemini imageConfig.aspectRatio, e.g. "16:9", "21:9", "9:16". */
  aspectRatio?: string
  /**
   * Optional seed for reproducibility. Two calls with the same prompt,
   * source images, AND seed produce very similar (though not pixel-
   * identical) compositions — useful for the spanduk preview → commit
   * flow where we generate a 1K preview, then regenerate at 4K only
   * if the user approves. Gemini accepts `generationConfig.seed` as
   * an int32.
   */
  seed?: number
}

export interface GenerateImageResult {
  bytes: Buffer
  mimeType: string
}

interface GeminiInlineData {
  data?: string
  mimeType?: string
  mime_type?: string
}

interface GeminiPart {
  text?: string
  inlineData?: GeminiInlineData
  inline_data?: GeminiInlineData
}

/**
 * Calls a Gemini image model's generateContent endpoint with an inline
 * source image and returns the first image part of the response.
 * Throws a descriptive error on HTTP failure or a response with no image.
 */
export async function generateGeminiImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const base = input.baseUrl.replace(/\/+$/, '')
  const url = `${base}/models/${encodeURIComponent(input.model)}:generateContent`

  const generationConfig: Record<string, unknown> = {
    responseModalities: ['IMAGE'],
  }
  if (input.imageSize || input.aspectRatio) {
    const imageConfig: Record<string, unknown> = {}
    if (input.imageSize) imageConfig.imageSize = input.imageSize
    if (input.aspectRatio) imageConfig.aspectRatio = input.aspectRatio
    generationConfig.imageConfig = imageConfig
  }
  if (input.seed !== undefined) {
    generationConfig.seed = input.seed
  }

  const requestParts: Array<
    { text: string } | { inline_data: { mime_type: string; data: string } }
  > = [{ text: input.prompt }]
  if (input.sourceImage) {
    requestParts.push({
      inline_data: {
        mime_type: input.sourceImage.mimeType,
        data: input.sourceImage.bytes.toString('base64'),
      },
    })
  }
  if (input.sourceImages) {
    for (const img of input.sourceImages) {
      requestParts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.bytes.toString('base64'),
        },
      })
    }
  }

  const body = {
    contents: [{ role: 'user', parts: requestParts }],
    generationConfig,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(
      `Gagal menghubungi penyedia gambar AI: ${
        err instanceof Error ? err.message : 'kesalahan jaringan'
      }`,
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Penyedia gambar AI menolak permintaan (HTTP ${res.status}): ${text.slice(0, 300)}`,
    )
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
  }
  const parts = json.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) {
      return {
        bytes: Buffer.from(inline.data, 'base64'),
        mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png',
      }
    }
  }

  throw new Error('Penyedia gambar AI tidak mengembalikan gambar.')
}
