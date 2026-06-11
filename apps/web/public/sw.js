// Vintra service worker — Web Push delivery only.
// Receives encrypted push payloads from the server (signed with our
// VAPID key), shows them as native OS notifications, and routes
// clicks to the app's /notifications page or a deeper URL when
// supplied in the payload.

self.addEventListener('install', (event) => {
  // Activate as soon as the new SW is installed (no need to wait for
  // all tabs to close). Safe because we don't cache anything here.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Vintra', body: event.data.text() }
  }
  const title = payload.title || 'Vintra'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.png',
    badge: '/favicon.png',
    data: { url: payload.url || '/notifications' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/notifications'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an existing tab on this origin if there's one open.
        for (const c of clientList) {
          if (c.url && c.focus) {
            try {
              const u = new URL(targetUrl, c.url)
              if (c.url === u.toString()) return c.focus()
            } catch {
              // fall through to opening a fresh window
            }
          }
        }
        // No matching tab — open a new one.
        return self.clients.openWindow(targetUrl)
      }),
  )
})
