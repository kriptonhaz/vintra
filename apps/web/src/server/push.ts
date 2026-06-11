import webpush from 'web-push'
import { db } from '@vintra/db'
import { pushSubscriptions } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'

let configured = false

/**
 * Lazy VAPID setup. Reading env vars at module load would crash the
 * import in tests / preview builds where they're not set; doing it on
 * first use means `sendPushToUser` is a no-op until the keys are
 * present and only fails in environments that actually try to push.
 */
function ensureConfigured() {
  if (configured) return true
  const subject = process.env.VAPID_SUBJECT
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!subject || !pub || !priv) {
    console.warn('[push] VAPID env vars missing — push delivery disabled')
    return false
  }
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

interface PushPayload {
  title: string
  body: string
  url?: string
  icon?: string
}

/**
 * Send a Web Push notification to every browser subscription a user
 * has. Failures are logged and swallowed so a notification insert
 * never fails just because push delivery hit a transient issue.
 *
 * 410 GONE / 404 → the browser unsubscribed; we delete the row.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensureConfigured()) return

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))

  if (subs.length === 0) return

  const body = JSON.stringify(payload)

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        )
      } catch (err: unknown) {
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode?: number }).statusCode
            : undefined
        if (statusCode === 410 || statusCode === 404) {
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id))
        } else {
          console.error('[push] send failed for', sub.endpoint, err)
        }
      }
    }),
  )
}
