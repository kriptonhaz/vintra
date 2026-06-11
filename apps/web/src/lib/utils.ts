import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatInTimeZone } from 'date-fns-tz'
import { id } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Vintra is Indonesia-only — every user, tenant, and timestamp is
 * interpreted in WIB (UTC+7). We pin the formatter to Asia/Jakarta so
 * SSR (Bun on Lightsail, typically UTC) and CSR (browser in user's local
 * TZ) produce identical output, sidestepping React #418 hydration
 * mismatches near UTC midnight (JUR-131 — supersedes JUR-97's incomplete
 * date-fns swap which still leaked the runtime TZ into the rendered day).
 *
 * `formatInTimeZone` reads the Date as UTC then renders in the target
 * zone, so any input — `Date` from a server fn or ISO string from
 * JSON-rehydrated query data — produces the same wall-clock readout.
 */
export function formatDate(date: Date | string, pattern = 'dd/MM/yyyy'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatInTimeZone(d, 'Asia/Jakarta', pattern, { locale: id })
}

/**
 * JUR-137: deterministic number formatting for the Indonesian locale.
 * Use this instead of `n.toLocaleString('id-ID', ...)` — the raw call
 * produces subtly different output between Bun (SSR) and V8 (client),
 * which triggers React hydration mismatches. Intl.NumberFormat is
 * stable across both runtimes.
 *
 * Defaults match the most common callsite (whole numbers, no
 * fractional digits). Pass options for explicit fraction control,
 * e.g. `{ maximumFractionDigits: 2 }` for prep batch quantities.
 */
export function formatNumberID(
  n: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat('id-ID', options).format(n)
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}
