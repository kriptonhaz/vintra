import { getRequest } from '@tanstack/react-start/server'

/**
 * Canonical public origin for building absolute links in emails / invites
 * (password reset, member invite, staff invite, etc.).
 *
 * Order of preference:
 *   1. `VITE_APP_URL` env — when explicitly set to a non-localhost value.
 *   2. The incoming request's forwarded host + proto. Behind nginx we get
 *      `Host: vintra.my.id` and `X-Forwarded-Proto: https`, so this yields
 *      the real public origin even when the server env lacks VITE_APP_URL
 *      (which is what made invite links land on http://localhost:3000).
 *   3. localhost — dev fallback only.
 */
export function getAppOrigin(): string {
  const env = process.env.VITE_APP_URL?.trim()
  if (env && !env.includes('localhost')) return env.replace(/\/+$/, '')

  try {
    const req = getRequest()
    const host =
      req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    if (host) {
      const isLocal = host.includes('localhost') || host.startsWith('127.')
      const proto =
        req.headers.get('x-forwarded-proto') ?? (isLocal ? 'http' : 'https')
      return `${proto}://${host}`
    }
  } catch {
    // getRequest() throws outside a request scope — fall through.
  }

  return env || 'http://localhost:3000'
}
