import type { SupabaseClient, AuthError, Session, User } from '@supabase/supabase-js'

type RefreshOutcome = {
  data: { user: User | null; session: Session | null }
  error: AuthError | null
  /** True when this outcome came from the cache instead of a fresh refresh. */
  cached?: boolean
}

/**
 * Coalesces + caches Supabase `refreshSession()` calls keyed by old
 * refresh token.
 *
 * Why: Supabase has refresh-token rotation enabled — every successful
 * refresh consumes the old token and issues a new one. Two distinct
 * races caused silent logouts:
 *
 *   (a) Two concurrent server requests on the same page both find
 *       the access token expired, both call refresh with the SAME
 *       old token. First wins; second gets "Already Used".
 *
 *   (b) A request lands at the server AFTER a previous request has
 *       already rotated the token (e.g. user clicked twice 300ms
 *       apart, or the browser-side supabase-js auto-refresh fired
 *       just before our server request). The request still carries
 *       the OLD refresh-token cookie (cookie hadn't propagated yet),
 *       so it tries to refresh with a now-consumed token.
 *
 * Fix: keep an in-process map keyed by the old refresh token.
 *   - First caller: start the actual refresh.
 *   - Concurrent callers: await the same promise (handles race a).
 *   - Callers within SUCCESS_CACHE_MS of resolution: get the cached
 *     successful outcome — same rotated tokens, no re-attempt
 *     (handles race b).
 *   - On failure: evict immediately so a follow-up call can try
 *     fresh (we never want to cache a known-bad result).
 *
 * `refreshSession()` THROWS on network errors (AuthRetryableFetchError
 * etc.) — the .then() chain doesn't catch throws, which is why the
 * "refresh FAILED" log line previously went missing on transient
 * failures. The try/catch below normalises throws into `{error}` so
 * the auth middleware always logs an outcome.
 *
 * Single replica only. If we ever scale `apps/web` to multiple Node
 * processes, this map needs to move to Redis.
 *
 * Dev note: we store the map on `globalThis` so it survives HMR reloads
 * in local development. Without this, every file save wipes the map,
 * and concurrent polls during the reload would all trigger fresh
 * refreshes and hit "Already Used" errors.
 */
declare global {
  // eslint-disable-next-line no-var
  var __jq_auth_inflight: Map<string, Promise<RefreshOutcome>> | undefined
}

if (!globalThis.__jq_auth_inflight) {
  globalThis.__jq_auth_inflight = new Map()
}
const inflight = globalThis.__jq_auth_inflight
// Wider than typical because we observed surprise logouts during the
// gap between a successful rotation and the new cookie reaching the
// browser (slow networks, paused tabs, 2s polls firing back-to-back).
// 60s gives the rotated cookie plenty of time to propagate before the
// cache entry is evicted and a stale-token caller can race fresh.
const SUCCESS_CACHE_MS = 60_000
const FAILURE_CACHE_MS = 0

export async function refreshSessionCoalesced(
  supabase: SupabaseClient,
  refreshToken: string,
): Promise<RefreshOutcome> {
  const existing = inflight.get(refreshToken)
  if (existing) {
    // Mark cached outcomes so the caller's log line can show
    // "from cache" vs "fresh refresh" — useful for diagnosing
    // whether the cache window is actually doing work.
    const outcome = await existing
    return { ...outcome, cached: true }
  }

  const promise: Promise<RefreshOutcome> = (async () => {
    try {
      const res = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      })
      return { data: res.data, error: res.error }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'refreshSession threw non-Error'
      return {
        data: { user: null, session: null },
        error: {
          name: 'RefreshSessionThrew',
          message,
          status: 0,
        } as unknown as AuthError,
      }
    }
  })()

  inflight.set(refreshToken, promise)

  promise.then((outcome) => {
    const cacheMs = outcome.error ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS
    if (cacheMs === 0) {
      if (inflight.get(refreshToken) === promise) {
        inflight.delete(refreshToken)
      }
      return
    }
    setTimeout(() => {
      if (inflight.get(refreshToken) === promise) {
        inflight.delete(refreshToken)
      }
    }, cacheMs)
  })

  return promise
}
