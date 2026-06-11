/**
 * Shared auth-cookie constants. Lives in `lib/` (no React, no
 * Supabase client) so both client code (use-auth.ts) and server code
 * (auth middleware) can pull from one source of truth.
 *
 * The cookies are deliberately long-lived: their only job is to ferry
 * the JWT to the server. The actual session lifetime is controlled by
 * Supabase's refresh-token inactivity timeout (Dashboard →
 * Authentication → Sessions). Cookie max-age must be ≥ that value or
 * users get logged out at the cookie layer before Supabase even runs.
 *
 * Sliding behaviour: every successful access-token refresh — whether
 * triggered by browser-side supabase-js or server-side middleware —
 * writes new cookies, resetting the max-age countdown. So an active
 * user effectively never expires; an idle user logs out after the
 * cookie window without activity.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days

export const ACCESS_TOKEN_COOKIE = 'sb-access-token'
export const REFRESH_TOKEN_COOKIE = 'sb-refresh-token'
