/**
 * JUR-91: tiny client-side helpers around the `jq_ref` cookie that
 * holds a captured referral code between page loads.
 *
 * - 30-day expiry: long enough that someone who clicks an Instagram
 *   link and registers a week later still gets attributed.
 * - NOT httpOnly: the client needs to read it to prefill the register
 *   form and to pass it through to ensureTenantForOAuth(). The cookie
 *   carries no auth, so the trade-off is fine.
 * - SameSite=Lax + Secure (in prod) match the project-wide cookie
 *   posture.
 *
 * Code normalisation: all reads + writes uppercase the value so the
 * server-side equality lookup (case-sensitive in Postgres) hits.
 */
const COOKIE_NAME = 'jq_ref'
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

export function readRefCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)jq_ref=([^;]+)/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!).toUpperCase()
  } catch {
    return null
  }
}

export function writeRefCookie(code: string): void {
  if (typeof document === 'undefined') return
  const normalised = code.trim().toUpperCase()
  if (!normalised) return
  const sec = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(normalised)}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${sec}`
}

export function clearRefCookie(): void {
  if (typeof document === 'undefined') return
  const sec = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax${sec}`
}

/**
 * Read `?ref=` from the current URL and, if present, persist it into
 * the cookie. Idempotent — safe to call on every render. Returns the
 * captured code (uppercase) or null.
 */
export function captureRefFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const raw = url.searchParams.get('ref')
  if (!raw) return null
  const normalised = raw.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{4,20}$/.test(normalised)) return null
  writeRefCookie(normalised)
  return normalised
}
