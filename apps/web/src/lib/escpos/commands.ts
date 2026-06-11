/**
 * ESC/POS command primitives. Each function returns a Uint8Array
 * chunk that can be concatenated with `concat()` into the final
 * byte buffer sent to the printer. Covers the small subset we need
 * for a 58mm/80mm receipt: init, alignment, text, line feed, font
 * size, raster bitmap, partial cut.
 *
 * Reference: ESC/POS Application Programming Guide (Epson). Most
 * cheap Chinese printers (RPP02N family) implement this subset
 * compatibly.
 */

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export function init(): Uint8Array {
  // ESC @  reset printer state to defaults.
  return new Uint8Array([ESC, 0x40])
}

export type Align = 'left' | 'center' | 'right'

export function align(a: Align): Uint8Array {
  const n = a === 'left' ? 0 : a === 'center' ? 1 : 2
  return new Uint8Array([ESC, 0x61, n])
}

/**
 * Encode + emit a text run. Characters outside ASCII (>= 0x80)
 * are stripped — receipts here are 99% ASCII; the Rp symbol is
 * always rendered as the literal "Rp" string, not U+20A8. Avoids
 * needing a CP437/CP850 code-page switch.
 */
export function text(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    out.push(code < 0x80 ? code : 0x3f) // '?' for anything non-ASCII
  }
  return new Uint8Array(out)
}

export function lf(n = 1): Uint8Array {
  const out = new Uint8Array(n)
  out.fill(LF)
  return out
}

/** ESC d n — feed n lines. Bounded to [0,255]. */
export function feed(n: number): Uint8Array {
  return new Uint8Array([ESC, 0x64, Math.max(0, Math.min(255, n | 0))])
}

/**
 * GS V 1 — partial cut. Many low-cost printers (incl. most RPP02N
 * units) have no auto-cutter; the command is silently ignored on
 * those, which is harmless. We still emit a `feed(4)` before any
 * cut so manual tearing has clean margin if the cutter is absent.
 */
export function cut(): Uint8Array {
  return new Uint8Array([GS, 0x56, 0x01])
}

/**
 * ESC ! n — set print mode. Bitfield:
 *   bit 0 = font B (narrow)        (we leave at 0 = font A)
 *   bit 3 = bold
 *   bit 4 = double-height
 *   bit 5 = double-width
 *   bit 7 = underline
 */
export function fontSize(opts: {
  bold?: boolean
  doubleHeight?: boolean
  doubleWidth?: boolean
}): Uint8Array {
  let n = 0
  if (opts.bold) n |= 0x08
  if (opts.doubleHeight) n |= 0x10
  if (opts.doubleWidth) n |= 0x20
  return new Uint8Array([ESC, 0x21, n])
}

/** Reset to default font A, single height/width, no bold. */
export function fontReset(): Uint8Array {
  return new Uint8Array([ESC, 0x21, 0x00])
}

/**
 * GS v 0 m xL xH yL yH d... — raster bit image.
 *   m = 0 (normal density, 1:1 dot mapping)
 *   widthBytes = ceil(widthDots / 8); little-endian (xL,xH) (yL,yH).
 *   data = `heightDots * widthBytes` bytes, MSB-first per byte.
 *
 * The `raster` argument is the packed 1-bit pixel buffer produced by
 * `ditherImage()` — this helper just wraps the header.
 */
export function rasterImage(
  raster: Uint8Array,
  widthDots: number,
  heightDots: number,
): Uint8Array {
  const widthBytes = Math.ceil(widthDots / 8)
  if (raster.length !== widthBytes * heightDots) {
    throw new Error(
      `rasterImage: expected ${widthBytes * heightDots} bytes, got ${raster.length}`,
    )
  }
  const xL = widthBytes & 0xff
  const xH = (widthBytes >> 8) & 0xff
  const yL = heightDots & 0xff
  const yH = (heightDots >> 8) & 0xff
  const header = new Uint8Array([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH])
  const out = new Uint8Array(header.length + raster.length)
  out.set(header, 0)
  out.set(raster, header.length)
  return out
}

/** Concatenate any number of byte chunks into one buffer. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
