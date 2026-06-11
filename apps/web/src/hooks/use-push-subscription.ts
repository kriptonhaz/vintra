import { useCallback, useEffect, useState } from 'react'
import {
  registerPushSubscription,
  unregisterPushSubscription,
} from '@/server/functions/notifications'

export type PushState =
  | 'unsupported' // browser lacks Notification or PushManager API
  | 'requires-pwa' // iOS Safari in a regular tab — push only works after Add-to-Home-Screen
  | 'denied' // permission denied — can only be re-enabled in browser settings
  | 'subscribed' // permission granted AND a subscription exists for this device
  | 'unsubscribed' // permission default OR granted-but-no-subscription on this device

export interface EnableResult {
  ok: boolean
  reason?: 'denied' | 'unsupported' | 'error' | 'dismissed'
  /**
   * Human-readable message to surface in toasts when ok=false. Always
   * filled when ok=false so callers don't need to map reason → copy.
   */
  message?: string
}

interface UsePushSubscriptionResult {
  state: PushState
  busy: boolean
  /**
   * True once the initial probe has finished. Components should usually
   * gate their render on this so they don't flash the "ask user" UI on
   * first mount before we know what state we're in.
   */
  ready: boolean
  /**
   * Has the user explicitly clicked "later" on the auto-prompt? Stored
   * in localStorage; survives page reloads but not browser cache clears.
   */
  promptDismissed: boolean
  enable: () => Promise<EnableResult>
  disable: () => Promise<void>
  dismissPrompt: () => void
  resetDismissPrompt: () => void
}

const DISMISS_KEY = 'jq-push-prompt-dismissed'

/**
 * Single source of truth for Web Push subscription state on the client.
 * Three components consume this:
 *   - <PushOptIn />              — settings/account page (always visible toggle)
 *   - <PushPermissionBanner />   — auto-prompt at top of authed pages
 *   - notifications page banner  — inline state banner with re-enable CTA
 *
 * The browser's permission state is the authoritative source. We only
 * persist `promptDismissed` ourselves (so the auto-banner doesn't nag
 * after the user clicks "later").
 */
export function usePushSubscription(): UsePushSubscriptionResult {
  const [state, setState] = useState<PushState>('unsupported')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [promptDismissed, setPromptDismissed] = useState(false)

  // Initial probe.
  useEffect(() => {
    let cancelled = false
    async function probe() {
      // Pull dismissal flag synchronously from localStorage. Wrap in
      // try/catch so SSR / private mode doesn't crash.
      try {
        setPromptDismissed(localStorage.getItem(DISMISS_KEY) === '1')
      } catch {
        // ignore
      }

      if (
        typeof window === 'undefined' ||
        !('Notification' in window) ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        // iOS Safari quirk: in a regular browser tab, PushManager
        // doesn't exist at all on the window. It only becomes
        // available after the user installs the site as a PWA via
        // "Add to Home Screen". Detect this case so we can show
        // install instructions instead of a flat "not supported".
        const isIOS =
          /iPad|iPhone|iPod/.test(navigator.userAgent) &&
          // iPadOS 13+ reports as "MacIntel" in the UA but is touch-
          // capable, so we add a touch check to catch it.
          (navigator.maxTouchPoints > 1 ||
            /iPad|iPhone|iPod/.test(navigator.userAgent))
        const isStandalone =
          window.matchMedia?.('(display-mode: standalone)').matches ||
          // Older iOS Safari uses a non-standard `navigator.standalone`.
          (navigator as unknown as { standalone?: boolean }).standalone === true

        if (!cancelled) {
          setState(isIOS && !isStandalone ? 'requires-pwa' : 'unsupported')
          setReady(true)
        }
        return
      }

      if (Notification.permission === 'denied') {
        if (!cancelled) {
          setState('denied')
          setReady(true)
        }
        return
      }

      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const sub = (await reg?.pushManager.getSubscription()) ?? null
        if (cancelled) return
        if (sub && Notification.permission === 'granted') {
          setState('subscribed')
        } else {
          setState('unsubscribed')
        }
      } catch {
        if (!cancelled) setState('unsubscribed')
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async (): Promise<EnableResult> => {
    if (state === 'unsupported') {
      return {
        ok: false,
        reason: 'unsupported',
        message: 'Browser tidak mendukung notifikasi push.',
      }
    }
    setBusy(true)
    try {
      // requestPermission is a no-op (returns the existing decision)
      // when permission has already been set, so calling it works
      // regardless of starting state.
      const permission = await Notification.requestPermission()
      if (permission === 'denied') {
        setState('denied')
        return {
          ok: false,
          reason: 'denied',
          message:
            'Izin notifikasi ditolak. Buka pengaturan browser untuk mengaktifkan.',
        }
      }
      if (permission !== 'granted') {
        // 'default' here means the user dismissed the prompt without
        // choosing (e.g., closed the popup). Not a hard failure.
        return {
          ok: false,
          reason: 'dismissed',
          message: 'Izin notifikasi belum diberikan.',
        }
      }

      // Ensure a service worker is registered + active. After a fresh
      // register() the SW is in 'installing' state; pushManager.subscribe
      // requires an *active* SW. `navigator.serviceWorker.ready` resolves
      // once any SW in this scope reaches the activated state — that's
      // the reliable wait point.
      let reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js')
      }
      reg = await navigator.serviceWorker.ready

      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        console.error('VITE_VAPID_PUBLIC_KEY missing — push disabled')
        return {
          ok: false,
          reason: 'error',
          message: 'Konfigurasi VAPID belum tersedia. Hubungi admin.',
        }
      }

      // Reuse an existing subscription if one is already attached to
      // this SW (covers the "permission was granted but our register
      // call previously failed" case — clicking Aktifkan again
      // recovers without creating a second endpoint).
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // BufferSource cast — Uint8Array<ArrayBufferLike> isn't
          // assignable to BufferSource under the latest DOM types
          // because ArrayBufferLike now includes SharedArrayBuffer.
          // The runtime input is always ArrayBuffer-backed.
          applicationServerKey: urlBase64ToUint8Array(
            vapidPublicKey,
          ) as unknown as BufferSource,
        })
      }

      const json = sub.toJSON()
      const p256dh = json.keys?.p256dh ?? ''
      const auth = json.keys?.auth ?? ''
      if (!p256dh || !auth) {
        console.error('[push] subscription missing keys', json)
        return {
          ok: false,
          reason: 'error',
          message: 'Subscription invalid (missing keys).',
        }
      }

      await registerPushSubscription({
        data: {
          endpoint: sub.endpoint,
          p256dh,
          auth,
          userAgent: navigator.userAgent,
        },
      })

      setState('subscribed')
      // A successful enable also clears any earlier "Nanti" dismissal —
      // the prompt is no longer needed.
      try {
        localStorage.removeItem(DISMISS_KEY)
      } catch {}
      setPromptDismissed(false)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[push] enable failed:', err)
      return {
        ok: false,
        reason: 'error',
        message: `Gagal mengaktifkan notifikasi: ${msg}`,
      }
    } finally {
      setBusy(false)
    }
  }, [state])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await unregisterPushSubscription({ data: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      setState('unsubscribed')
    } finally {
      setBusy(false)
    }
  }, [])

  const dismissPrompt = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {}
    setPromptDismissed(true)
  }, [])

  const resetDismissPrompt = useCallback(() => {
    try {
      localStorage.removeItem(DISMISS_KEY)
    } catch {}
    setPromptDismissed(false)
  }, [])

  return {
    state,
    busy,
    ready,
    promptDismissed,
    enable,
    disable,
    dismissPrompt,
    resetDismissPrompt,
  }
}

/**
 * VAPID public keys travel as base64url; the Web Push API wants a
 * Uint8Array. Standard conversion helper from the spec examples.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}
