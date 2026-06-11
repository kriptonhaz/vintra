/**
 * Thin fetch wrapper that talks to Vintra's TanStack Start server
 * functions, attaching the Supabase access token as a Bearer header
 * and (when set) an X-Tenant-Id header for multi-tenant scoping.
 *
 * The server already accepts both — see apps/web/src/server/middleware/auth.ts
 * extractToken() + extractRequestedTenantId().
 *
 * Server fns are reachable at: `${API_BASE}/_server/<fn-name>`. The
 * fn-name segment is set by TanStack Start at build time per-function;
 * we expose `callServerFn(name, body)` as the only call shape so
 * future server-side fn renames stay isolated to one place.
 */
import { supabase } from './supabase'
import Constants from 'expo-constants'

const extras = (Constants.expoConfig?.extra ?? {}) as Record<string, string>

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  extras.API_URL ??
  'https://vintra.my.id'

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

interface CallOptions {
  /** Tenant scope for this call. Omit to let the server pick the
   *  user's oldest membership (matches web behavior). */
  tenantId?: string | null
  /** AbortSignal — wire up for cancellable React Query calls. */
  signal?: AbortSignal
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * Calls a server function by name with a JSON-serializable body.
 * Returns the parsed JSON response, or throws ApiError on non-2xx.
 *
 * Server fns are mounted under `/_server/<fn>` by TanStack Start;
 * GET fns use a query string, POST fns use a JSON body. We always
 * POST (TanStack supports POST for read fns via `{method: 'POST'}`
 * in createServerFn — the existing fns use both shapes).
 */
export async function callServerFn<TResponse = unknown>(
  fnName: string,
  body: unknown = {},
  opts: CallOptions = {},
): Promise<TResponse> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.tenantId) headers['X-Tenant-Id'] = opts.tenantId

  // Mobile endpoints live under /api/mobile/<fn> — see apps/web/src/routes/api.mobile.$fn.ts.
  // TanStack Start's internal RPC URLs aren't externally callable, so we
  // wrap each server fn we need with a hand-curated dispatcher route.
  const res = await fetch(`${API_BASE}/api/mobile/${fnName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: body }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text)
  }

  return (await res.json()) as TResponse
}
