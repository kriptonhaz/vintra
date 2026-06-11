import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { feedbackThreads, feedbackMessages, tenants } from '@vintra/db/schema'
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import { notifyTenantOfAdminFeedbackReply } from '../feedback-notifications'
import { buildContactReplyEmail, sendEmail } from '../email'

const APP_URL =
  process.env.VITE_APP_URL ?? process.env.APP_URL ?? 'https://vintra.my.id'

const listInput = z.object({
  status: z.enum(['open', 'replied', 'resolved', 'all']).default('all'),
  source: z.enum(['in_app', 'public', 'all']).default('all'),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
})

export const listAdminFeedbackThreads = createServerFn({ method: 'POST' })
  .inputValidator(listInput)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const conditions = []
    if (data.status !== 'all') conditions.push(eq(feedbackThreads.status, data.status))
    if (data.source !== 'all') conditions.push(eq(feedbackThreads.source, data.source))
    if (data.search?.trim()) {
      const q = `%${data.search.trim()}%`
      conditions.push(
        or(
          ilike(feedbackThreads.subject, q),
          ilike(tenants.businessName, q),
        ),
      )
    }

    const PAGE_SIZE = 30
    const offset = (data.page - 1) * PAGE_SIZE

    const rows = await db
      .select({
        id: feedbackThreads.id,
        subject: feedbackThreads.subject,
        status: feedbackThreads.status,
        source: feedbackThreads.source,
        lastMessageAt: feedbackThreads.lastMessageAt,
        createdAt: feedbackThreads.createdAt,
        tenantId: feedbackThreads.tenantId,
        tenantName: tenants.businessName,
      })
      .from(feedbackThreads)
      .leftJoin(tenants, eq(feedbackThreads.tenantId, tenants.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(feedbackThreads.lastMessageAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return rows
  })

const idInput = z.object({ threadId: z.string().uuid() })

export const getAdminFeedbackThread = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [thread] = await db
      .select({
        id: feedbackThreads.id,
        subject: feedbackThreads.subject,
        status: feedbackThreads.status,
        source: feedbackThreads.source,
        createdAt: feedbackThreads.createdAt,
        lastMessageAt: feedbackThreads.lastMessageAt,
        tenantId: feedbackThreads.tenantId,
        tenantName: tenants.businessName,
        // JUR-148: surface public-thread submitter contact info so the
        // admin can confirm who they're about to email.
        publicEmail: feedbackThreads.publicEmail,
        publicName: feedbackThreads.publicName,
      })
      .from(feedbackThreads)
      .leftJoin(tenants, eq(feedbackThreads.tenantId, tenants.id))
      .where(eq(feedbackThreads.id, data.threadId))
      .limit(1)

    if (!thread) throw new Error('Thread tidak ditemukan')

    const messages = await db
      .select()
      .from(feedbackMessages)
      .where(eq(feedbackMessages.threadId, data.threadId))
      .orderBy(feedbackMessages.createdAt)

    return { thread, messages }
  })

const replyInput = z.object({
  threadId: z.string().uuid(),
  body: z.string().min(1),
})

export const replyAsAdmin = createServerFn({ method: 'POST' })
  .inputValidator(replyInput)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [thread] = await db
      .select({
        id: feedbackThreads.id,
        tenantId: feedbackThreads.tenantId,
        subject: feedbackThreads.subject,
        source: feedbackThreads.source,
        publicEmail: feedbackThreads.publicEmail,
        publicName: feedbackThreads.publicName,
      })
      .from(feedbackThreads)
      .where(eq(feedbackThreads.id, data.threadId))
      .limit(1)
    if (!thread) throw new Error('Thread tidak ditemukan')

    const [msg] = await db
      .insert(feedbackMessages)
      .values({
        threadId: data.threadId,
        senderType: 'admin',
        senderUserId: auth.userId,
        body: data.body,
      })
      .returning()

    const now = new Date()
    await db
      .update(feedbackThreads)
      .set({ status: 'replied', lastMessageAt: now, updatedAt: now })
      .where(eq(feedbackThreads.id, data.threadId))

    // JUR-148: public threads route the reply through Brevo email
    // because the submitter has no in-app inbox. We deliberately don't
    // throw on send failure here — the admin's reply message row + the
    // 'replied' status flip are the source of truth, so a Brevo glitch
    // shouldn't roll back the admin's work. Failed sends are logged and
    // recoverable by re-clicking "Kirim Balasan".
    if (msg && thread.source === 'public' && thread.publicEmail) {
      const [firstMsg] = await db
        .select({ body: feedbackMessages.body })
        .from(feedbackMessages)
        .where(eq(feedbackMessages.threadId, data.threadId))
        .orderBy(asc(feedbackMessages.createdAt))
        .limit(1)

      const emailBody = buildContactReplyEmail({
        name: thread.publicName ?? 'Sahabat Vintra',
        originalSubject: thread.subject,
        originalBody: firstMsg?.body ?? '',
        replyBody: data.body,
        contactUrl: `${APP_URL}/contact`,
      })
      await sendEmail({
        to: thread.publicEmail,
        toName: thread.publicName ?? undefined,
        ...emailBody,
        tag: 'contact_admin_reply',
      })
    }

    // In-app threads notify the tenant (owner + every member who posted
    // in the thread) via the existing helper.
    if (msg && thread.source === 'in_app' && thread.tenantId) {
      await notifyTenantOfAdminFeedbackReply({
        threadId: data.threadId,
        messageId: msg.id,
        tenantId: thread.tenantId,
        subject: thread.subject,
        body: data.body,
      })
    }

    return msg
  })

const setStatusInput = z.object({
  threadId: z.string().uuid(),
  status: z.enum(['open', 'replied', 'resolved']),
})

export const setFeedbackStatus = createServerFn({ method: 'POST' })
  .inputValidator(setStatusInput)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const now = new Date()
    await db
      .update(feedbackThreads)
      .set({ status: data.status, updatedAt: now })
      .where(eq(feedbackThreads.id, data.threadId))

    return { ok: true }
  })
