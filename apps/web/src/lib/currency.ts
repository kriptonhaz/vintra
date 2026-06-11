// Bun's JavaScriptCore and V8 (Node + Chrome) disagree on how to format
// `style: 'currency', currency: 'IDR'` in `id-ID` — V8 inserts a NBSP
// (U+00A0) between "Rp" and the digits, JSC produces "Rp1.000" with no
// space. The mismatch fires React #418 (hydration error) on every SSR
// page that renders a Rupiah value (JUR-17). Stick to a deterministic
// decimal formatter and prepend the prefix ourselves.
const decimalFormatter = new Intl.NumberFormat('id-ID', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

/** Format `amount` as `Rp 1.000` (regular ASCII space, identical SSR + CSR). */
export function formatRupiah(amount: number): string {
  return `Rp ${decimalFormatter.format(amount)}`
}

/** @deprecated Use formatRupiah instead — it now supports decimals */
export const formatRupiahDecimal = formatRupiah

export function parseRupiah(value: string): number {
  const cleaned = value.replace(/[^\d]/g, '')
  return Number(cleaned) || 0
}

/**
 * Format an integer in the Indonesian thousand-separator convention
 * (e.g. 100000 → "100.000"). No "Rp" prefix. Use this when you need
 * just the number portion (e.g. "100 poin", or split layouts).
 *
 * Replaces raw `(n).toLocaleString('id-ID')` calls in components —
 * the raw call is also affected by the Bun/V8 NBSP divergence in
 * some locale data, this helper sidesteps that by going through the
 * shared decimal formatter above.
 */
export function formatNumberId(value: number): string {
  return decimalFormatter.format(value)
}

/**
 * Compact Rupiah formatter for tight spaces (mobile cards, IG bios).
 * Indonesian short-form convention:
 *   <  1.000              → "Rp 500"            (passthrough)
 *   1.000-999.000         → "Rp 4K", "Rp 25K"
 *   1JT-999JT             → "Rp 1.5JT", "Rp 12JT"
 *   1M-999M (miliar)      → "Rp 1.2M", "Rp 350M"
 *   ≥ 1T (triliun)        → "Rp 1.5T", "Rp 98T"
 *
 * Decimals only when they add precision — 4000 → "4K" not "4.0K";
 * 4500 → "4.5K". Same rule applies to every tier.
 */
export function formatRupiahShort(amount: number): string {
  if (!Number.isFinite(amount)) return 'Rp 0'
  const n = Math.abs(amount)
  let formatted: string
  if (n >= 1_000_000_000_000) {
    formatted = `${trimDecimal(amount / 1_000_000_000_000)}T`
  } else if (n >= 1_000_000_000) {
    formatted = `${trimDecimal(amount / 1_000_000_000)}M`
  } else if (n >= 1_000_000) {
    formatted = `${trimDecimal(amount / 1_000_000)}JT`
  } else if (n >= 1_000) {
    formatted = `${trimDecimal(amount / 1_000)}K`
  } else {
    formatted = decimalFormatter.format(amount)
  }
  return `Rp ${formatted}`
}

/** "4.0" → "4", "4.5" → "4,5" (Indonesian decimal separator). */
function trimDecimal(v: number): string {
  if (Number.isInteger(v)) return String(v)
  // One decimal place, Indonesian comma.
  return v.toFixed(1).replace('.', ',').replace(/,0$/, '')
}
