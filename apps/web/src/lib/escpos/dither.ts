/**
 * Client-only image dithering for ESC/POS raster bit images.
 * Loads a logo (data URL or http URL), scales it to fit `targetWidth`
 * dots wide, applies Floyd-Steinberg error diffusion to produce a
 * 1-bit-per-pixel buffer packed MSB-first per byte — the exact format
 * the `GS v 0` raster command expects.
 *
 * Browser-only: uses `Image` + 2D canvas, not available in the SSR
 * Node entry. Callers must invoke from a client component.
 */

import { rasterImage } from './commands'

export interface DitheredImage {
  /** Packed 1-bit pixel buffer, MSB-first per byte. */
  raster: Uint8Array
  widthDots: number
  heightDots: number
}

/**
 * Load a logo and dither it to a 1-bit raster sized for the given
 * paper width. Returns null on any error (network, decode, etc) so
 * callers can fall back to a logo-less receipt.
 */
export async function ditherImage(
  src: string,
  targetWidthDots: number,
): Promise<DitheredImage | null> {
  if (typeof document === 'undefined') return null
  let img: HTMLImageElement
  try {
    img = await loadImage(src)
  } catch {
    return null
  }

  // Constrain logo to half the paper width, capped at 200 dots tall
  // so an unusually tall logo never eats the whole receipt.
  const widthDots = Math.min(targetWidthDots, Math.floor(targetWidthDots * 0.8))
  const aspect = img.naturalHeight / img.naturalWidth
  let heightDots = Math.round(widthDots * aspect)
  if (heightDots > 200) {
    heightDots = 200
  }
  // ESC/POS raster width must be a multiple of 8 dots — pad to byte
  // boundary so packing math is exact.
  const widthBytes = Math.ceil(widthDots / 8)
  const paddedWidth = widthBytes * 8

  const canvas = document.createElement('canvas')
  canvas.width = paddedWidth
  canvas.height = heightDots
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // White background so transparent PNGs don't dither into a black
  // smear.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, paddedWidth, heightDots)
  // Center horizontally if widthDots < paddedWidth.
  const offsetX = Math.floor((paddedWidth - widthDots) / 2)
  ctx.drawImage(img, offsetX, 0, widthDots, heightDots)

  const { data } = ctx.getImageData(0, 0, paddedWidth, heightDots)
  // Convert to grayscale luminance buffer for Floyd-Steinberg.
  const lum = new Float32Array(paddedWidth * heightDots)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    lum[j] =
      0.299 * (data[i] ?? 0) +
      0.587 * (data[i + 1] ?? 0) +
      0.114 * (data[i + 2] ?? 0)
  }

  // Floyd-Steinberg: serpentine not required for receipts.
  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < paddedWidth; x++) {
      const idx = y * paddedWidth + x
      const old = lum[idx] ?? 0
      const next = old < 128 ? 0 : 255
      lum[idx] = next
      const err = old - next
      if (x + 1 < paddedWidth) lum[idx + 1] = (lum[idx + 1] ?? 0) + (err * 7) / 16
      if (y + 1 < heightDots) {
        if (x > 0)
          lum[idx + paddedWidth - 1] =
            (lum[idx + paddedWidth - 1] ?? 0) + (err * 3) / 16
        lum[idx + paddedWidth] = (lum[idx + paddedWidth] ?? 0) + (err * 5) / 16
        if (x + 1 < paddedWidth)
          lum[idx + paddedWidth + 1] =
            (lum[idx + paddedWidth + 1] ?? 0) + (err * 1) / 16
      }
    }
  }

  // Pack MSB-first: bit set = print black dot.
  const raster = new Uint8Array(widthBytes * heightDots)
  for (let y = 0; y < heightDots; y++) {
    for (let xByte = 0; xByte < widthBytes; xByte++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit
        if (lum[y * paddedWidth + x] === 0) {
          byte |= 1 << (7 - bit)
        }
      }
      raster[y * widthBytes + xByte] = byte
    }
  }

  return { raster, widthDots: paddedWidth, heightDots }
}

/**
 * Convenience: dither + wrap with GS v 0 header in one call. Returns
 * an empty buffer if the image can't be loaded.
 */
export async function ditherImageToCommand(
  src: string,
  targetWidthDots: number,
): Promise<Uint8Array> {
  const d = await ditherImage(src, targetWidthDots)
  if (!d) return new Uint8Array(0)
  return rasterImage(d.raster, d.widthDots, d.heightDots)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}
