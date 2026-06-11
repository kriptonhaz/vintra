import { createClient } from '@supabase/supabase-js'
import { db } from '@vintra/db'
import {
  feedbackMessages,
  feedbackThreads,
  platformAdmins,
  tenants,
} from '@vintra/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { NOTIFICATION_TYPES } from '@vintra/shared'
import { createNotification } from './notifications'
import { buildFeedbackReplyEmail, sendEmail } from './email'

const APP_URL =
  process.env.VITE_APP_URL ?? process.env.APP_URL ?? 'https://vintra.my.id'

function preview(body: string, max = 160): string {
  const compact = body.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return compact.slice(0, max - 1).trimEnd() + '…'
}

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}

async function getTenantOwnerEmail(ownerId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.auth.admin.getUserById(ownerId)
    if (error) return null
    return data.user?.email ?? null
  } catch {
    return null
  }
}

export async function notifyAdminsOfNewFeedback(input: {
  threadId: string
  messageId: string
  tenantId: string | null
  tenantName: string
  subject: string
  body: string
  kind: 'new_thread' | 'tenant_reply'
}) {
  try {
    const admins = await db
      .select({ userId: platformAdmins.userId })
      .from(platformAdmins)
    const title =
      input.kind === 'new_thread'
        ? `Feedback baru dari ${input.tenantName}`
        : `Balasan feedback dari ${input.tenantName}`
    const type =
      input.kind === 'new_thread'
        ? NOTIFICATION_TYPES.feedbackNewThread
        : NOTIFICATION_TYPES.feedbackTenantReply

    await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: admin.userId,
          tenantId: input.tenantId,
          type,
          title,
          body: `${input.subject}: ${preview(input.body)}`,
          url: '/admin/feedback',
          data: {
            threadId: input.threadId,
            messageId: input.messageId,
            subject: input.subject,
          },
          sourceKey: `feedback:${input.kind}:${input.messageId}`,
        }),
      ),
    )
  } catch (err) {
    console.error('[feedback] admin notification failed:', err)
  }
}

export async function notifyTenantOfAdminFeedbackReply(input: {
  threadId: string
  messageId: string
  tenantId: string
  subject: string
  body: string
}) {
  try {
    const [tenant] = await db
      .select({
        ownerId: tenants.ownerId,
        businessName: tenants.businessName,
      })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1)
    if (!tenant) return

    const participantRows = await db
      .select({ userId: feedbackMessages.senderUserId })
      .from(feedbackMessages)
      .where(
        and(
          eq(feedbackMessages.threadId, input.threadId),
          eq(feedbackMessages.senderType, 'tenant'),
        ),
      )

    const recipientIds = new Set<string>([tenant.ownerId])
    for (const row of participantRows) {
      if (row.userId) recipientIds.add(row.userId)
    }

    await Promise.all(
      Array.from(recipientIds).map((userId) =>
        createNotification({
          userId,
          tenantId: input.tenantId,
          type: NOTIFICATION_TYPES.feedbackAdminReply,
          title: 'Feedback Anda sudah dibalas',
          body: `${input.subject}: ${preview(input.body)}`,
          url: `/help/feedback/${input.threadId}`,
          data: {
            threadId: input.threadId,
            messageId: input.messageId,
            subject: input.subject,
          },
          sourceKey: `feedback:admin_reply:${input.messageId}`,
        }),
      ),
    )
  } catch (err) {
    console.error('[feedback] tenant notification failed:', err)
  }
}

export async function sendDueFeedbackReplyEmails() {
  const rows = await db
    .select({
      messageId: feedbackMessages.id,
      threadId: feedbackMessages.threadId,
      body: feedbackMessages.body,
      subject: feedbackThreads.subject,
      ownerId: tenants.ownerId,
      tenantName: tenants.businessName,
    })
    .from(feedbackMessages)
    .innerJoin(feedbackThreads, eq(feedbackMessages.threadId, feedbackThreads.id))
    .innerJoin(tenants, eq(feedbackThreads.tenantId, tenants.id))
    .where(
      and(
        eq(feedbackMessages.senderType, 'admin'),
        isNull(feedbackMessages.emailSentAt),
        sql`${feedbackMessages.createdAt} <= now() - interval '24 hours'`,
        sql`(${feedbackThreads.tenantLastViewedAt} IS NULL OR ${feedbackThreads.tenantLastViewedAt} < ${feedbackMessages.createdAt})`,
      ),
    )
    .limit(100)

  for (const row of rows) {
    const email = await getTenantOwnerEmail(row.ownerId)
    if (!email) {
      await db
        .update(feedbackMessages)
        .set({ emailSentAt: new Date() })
        .where(eq(feedbackMessages.id, row.messageId))
      continue
    }

    const feedbackPath = `/help/feedback/${row.threadId}`
    const emailBody = buildFeedbackReplyEmail({
      tenantName: row.tenantName,
      subject: row.subject,
      replyPreview: row.body,
      feedbackUrl: `${APP_URL}${feedbackPath}`,
    })
    const sent = await sendEmail({
      to: email,
      toName: row.tenantName,
      ...emailBody,
      tag: 'feedback_admin_reply_fallback',
    })
    if (sent) {
      await db
        .update(feedbackMessages)
        .set({ emailSentAt: new Date() })
        .where(eq(feedbackMessages.id, row.messageId))
    }
  }
}
