/**
 * Marks that an OAuth round-trip was started from the *register* page
 * rather than the *login* page.
 *
 * Both pages call `signInWithOAuth` with an identical
 * `redirectTo: /auth/callback`, so once Google hands control back there
 * is nothing left in the request to say which button was pressed. That
 * matters for the "you already belong to {tenant}" notice: it is useful
 * exactly once, when somebody tries to register a NEW business on an
 * account that already belongs to one. Showing it on every login would
 * put a speed bump in front of every staff member, every day.
 *
 * Same cookie posture as the referral cookie (see referral-cookie.ts)
 * minus the long expiry — this one only has to outlive a redirect to
 * Google and back, so ten minutes is generous. It is cleared as soon as
 * the callback has read it, success or not.
 *
 * (The `vtr_` prefix is the current one; `jq_ref` predates the rename.)
 */
const COOKIE_NAME = 'vtr_signup'
const MAX_AGE_SECONDS = 10 * 60 // 10 minutes — one OAuth round-trip

export function markSignupIntent(): void {
  if (typeof document === 'undefined') return
  const sec = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${sec}`
}

export function readSignupIntent(): boolean {
  if (typeof document === 'undefined') return false
  return /(?:^|;\s*)vtr_signup=1(?:;|$)/.test(document.cookie)
}

export function clearSignupIntent(): void {
  if (typeof document === 'undefined') return
  const sec = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax${sec}`
}
