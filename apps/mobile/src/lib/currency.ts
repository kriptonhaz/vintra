/**
 * Indonesian Rupiah formatter — mirrors the web's `apps/web/src/lib/currency.ts`
 * single-source idea (deterministic decimal formatter + manual "Rp "
 * prefix, ASCII space — avoids Intl's NBSP that breaks SSR diffs).
 *
 * Why not import from `@vintra/shared`: the web's version lives in
 * apps/web (not the shared package) because it's web-only history.
 * Cleanest move is a small mobile copy here until we decide to extract
 * to shared — premature DRY across two consumers isn't worth a refactor.
 */
const decimalFormatter = new Intl.NumberFormat('id-ID', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Format `amount` as `Rp 25.000` (regular ASCII space). */
export function formatRupiah(amount: number): string {
  return `Rp ${decimalFormatter.format(amount)}`
}

/** "100000" → 100000 — strips Rp prefix + thousands separators for input fields. */
export function parseRupiah(value: string): number {
  const cleaned = value.replace(/[^\d]/g, '')
  return Number(cleaned) || 0
}
