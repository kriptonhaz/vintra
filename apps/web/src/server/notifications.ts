import { db } from '@vintra/db'
import { notifications } from '@vintra/db/schema'
import type { NotificationType } from '@vintra/shared'
import { sendPushToUser } from './push'

interface CreateNotificationInput {
  userId: string
  tenantId?: string | null
  type: NotificationType
  title: string
  body: string
  url?: string
  data?: Record<string, unknown>
  /**
   * Optional idempotency key. When set, INSERT uses ON CONFLICT DO
   * NOTHING against the `(user_id, type, source_key)` partial unique
   * index. Use for scheduled / repeatable triggers (clock-in reminder
   * once-per-day, trial-expiring-soon once-per-trial, etc.). Omit for
   * one-shot events (broadcasts, ad-hoc admin actions) where each
   * call should always insert a fresh row.
   */
  sourceKey?: string
}

/**
 * Single chokepoint every emitter calls. Inserts the notification row
 * (idempotently when sourceKey is set), then fans out to Web Push
 * subscriptions. Returns the inserted row, or null when the insert
 * was skipped due to an existing dedup match.
 *
 * Failures inside this function are NEVER thrown to callers — a
 * notification glitch must never roll back a financial transaction
 * or other parent operation. Errors are logged.
 */
export async function createNotification(opts: CreateNotificationInput) {
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: opts.userId,
        tenantId: opts.tenantId ?? null,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        url: opts.url ?? null,
        data: (opts.data as never) ?? null,
        sourceKey: opts.sourceKey ?? null,
      })
      .onConflictDoNothing()
      .returning()

    if (!row) return null

    // Fire-and-forget push. Awaited so Promise.all batches in callers
    // can rely on completion, but errors inside sendPushToUser are
    // already swallowed there.
    await sendPushToUser(opts.userId, {
      title: opts.title,
      body: opts.body,
      url: opts.url,
    })

    return row
  } catch (err) {
    console.error('[notifications] createNotification failed:', err)
    return null
  }
}
