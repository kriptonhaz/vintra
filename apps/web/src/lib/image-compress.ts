/**
 * Resize + recompress an image File on the client before upload. Business
 * owners take photos with their phones; raw mobile snapshots are
 * regularly 3–5 MB at 4032×3024. Sending those over a metered
 * connection (and storing them on S3) is wasteful.
 *
 * Strategy:
 *   1. Decode the source File into an HTMLImageElement.
 *   2. Compute target dimensions: cap the longest edge at `maxEdge`
 *      while preserving aspect ratio. Smaller images pass through
 *      unchanged in dimensions but still get re-encoded for
 *      consistent quality.
 *   3. Draw onto a canvas at the target size, export as JPEG at
 *      `quality` (default 0.8). 800px @ 0.8 lands around 80–150 KB
 *      for typical product photos — well under the 500 KB server cap.
 *   4. Return a data URL ready to ship to the server fn.
 *
 * EXIF orientation is intentionally NOT handled here — modern
 * iOS/Android cameras already write upright pixels. If we see
 * sideways photos in the wild we can pull in `blueimp-load-image` or
 * similar; not worth the bundle size pre-emptively.
 */
export async function compressImage(
  file: File,
  opts: { maxEdge?: number; quality?: number; targetBytes?: number } = {},
): Promise<{ dataUrl: string; bytes: number; mimeType: 'image/jpeg' }> {
  const maxEdge = opts.maxEdge ?? 800
  const quality = opts.quality ?? 0.8
  const targetBytes = opts.targetBytes

  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar.')
  }

  const sourceUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(sourceUrl)
    let { width, height } = scaleToFit(img.width, img.height, maxEdge)

    const render = (w: number, h: number, q: number): string => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx)
        throw new Error('Browser tidak mendukung canvas untuk kompres foto.')
      // High-quality downscale, and white backing so transparent PNGs
      // don't turn into black blocks in the JPEG output.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      return canvas.toDataURL('image/jpeg', q)
    }

    let dataUrl = render(width, height, quality)
    let bytes = estimateDataUrlBytes(dataUrl)

    // When a size budget is given, keep the dimensions sharp and instead
    // step the JPEG quality down until it fits; only as a last resort
    // (still too big at low quality) do we shrink the pixels. This keeps
    // large banners crisp rather than blanket-downscaling to 800px.
    if (targetBytes && bytes > targetBytes) {
      for (
        let q = quality - 0.07;
        q >= 0.5 && bytes > targetBytes;
        q -= 0.07
      ) {
        dataUrl = render(width, height, q)
        bytes = estimateDataUrlBytes(dataUrl)
      }
      // Still over budget at q=0.5 → progressively reduce resolution.
      let guard = 0
      while (bytes > targetBytes && Math.max(width, height) > 600 && guard < 6) {
        width = Math.round(width * 0.85)
        height = Math.round(height * 0.85)
        dataUrl = render(width, height, 0.7)
        bytes = estimateDataUrlBytes(dataUrl)
        guard++
      }
    }

    return { dataUrl, bytes, mimeType: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gagal memuat gambar.'))
    img.src = src
  })
}

function scaleToFit(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

/**
 * Approximate byte length of a base64 data URL — fast enough that we
 * don't need to decode it. Used for the "X KB" hint in the upload UI.
 */
function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx === -1) return 0
  const base64Length = dataUrl.length - commaIdx - 1
  // base64 expands input by ~4/3, so we divide back to get the byte
  // estimate. Padding ('=' chars) makes this slightly approximate.
  return Math.floor((base64Length * 3) / 4)
}
