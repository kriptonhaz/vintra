/**
 * Convert a browser `GeolocationPositionError` into a user-friendly,
 * platform-aware help string.
 *
 * Why this exists: the raw error.message is just the spec phrase
 * ("User denied Geolocation") which doesn't tell a non-technical user
 * how to fix it. iOS in particular has two permission layers (OS-level
 * per-app + per-site inside the browser) and tickets pile up because
 * users see "App-level allowed in iOS settings" and don't know about
 * the per-site one. We detect the OS+browser from userAgent and
 * surface the right "Buka pengaturan…" path inline.
 *
 * Returns the full message ready for display (multi-line, joined with
 * newlines). Render with `whitespace-pre-line` so the steps wrap nicely.
 */

type TFn = (key: string) => string

export function formatGeolocationError(
  err: GeolocationPositionError,
  t: TFn,
): string {
  switch (err.code) {
    case 1: {
      // PERMISSION_DENIED — covers both the in-page prompt being
      // dismissed/blocked and the iOS WebKit per-site memory.
      const help = pickPermissionHelpKey()
      return `${t('geolocation.errorPermissionDenied')}\n\n${t(help)}`
    }
    case 2:
      // POSITION_UNAVAILABLE — GPS hardware reachable but couldn't fix
      // a location. Typical causes: indoors, no signal, location
      // services disabled at the OS layer entirely.
      return t('geolocation.errorPositionUnavailable')
    case 3:
      // TIMEOUT — exceeded our `timeout` option without a fix.
      return t('geolocation.errorTimeout')
    default:
      // Unknown PositionError code — fall back to the raw message so
      // the user at least has something to share with support.
      return err.message || t('geolocation.errorUnknown')
  }
}

/**
 * Best-effort browser + OS sniff. We only use this to pick which
 * help string to show — getting it wrong shows the wrong steps but
 * doesn't break the underlying feature, so a loose heuristic is fine.
 *
 * iOS detection short-circuits because every iOS browser is WebKit
 * (Apple's App Store policy) and they all behave the same way; only
 * the menu paths differ. Android Chrome is real Blink so it gets a
 * different help string. Desktop variants follow the usual splits.
 */
function pickPermissionHelpKey(): string {
  if (typeof navigator === 'undefined') {
    return 'geolocation.helpGeneric'
  }
  const ua = navigator.userAgent
  // iOS family — all WebKit under the hood, only UI/menu differs.
  if (/iPad|iPhone|iPod/.test(ua)) {
    if (/CriOS/.test(ua)) return 'geolocation.helpIosChrome'
    if (/FxiOS/.test(ua)) return 'geolocation.helpIosFirefox'
    if (/EdgiOS/.test(ua)) return 'geolocation.helpIosEdge'
    if (/Brave/.test(ua)) return 'geolocation.helpIosBrave'
    return 'geolocation.helpIosSafari'
  }
  // Android — real Blink for most browsers. Samsung Internet has its
  // own menu that's worth calling out separately.
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'geolocation.helpAndroidSamsung'
    if (/Firefox/.test(ua)) return 'geolocation.helpAndroidFirefox'
    return 'geolocation.helpAndroidChrome'
  }
  // Desktop fall-throughs. Order matters: Edg/ must match before
  // Chrome (Edge UA contains "Chrome/"), Safari before falling
  // through to Chrome (Safari's UA also contains "Safari").
  if (/Edg\//.test(ua)) return 'geolocation.helpDesktopEdge'
  if (/Firefox/.test(ua)) return 'geolocation.helpDesktopFirefox'
  if (/Chrome\//.test(ua)) return 'geolocation.helpDesktopChrome'
  if (/Safari/.test(ua)) return 'geolocation.helpDesktopSafari'
  return 'geolocation.helpGeneric'
}
