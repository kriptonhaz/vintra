import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { db } from '@vintra/db'
import { feedbackThreads, feedbackMessages, tenants } from '@vintra/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import { notifyAdminsOfNewFeedback } from '../feedback-notifications'

// ─── Create thread + first message ───────────────────────────────

const createThreadInput = z.object({
  subject: z.string().min(1).max(255),
  body: z.string().min(1),
})

export const createFeedbackThread = createServerFn({ method: 'POST' })
  .inputValidator(createThreadInput)
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()
    const now = new Date()

    const [thread] = await db
      .insert(feedbackThreads)
      .values({
        tenantId,
        source: 'in_app',
        subject: data.subject,
        status: 'open',
        lastMessageAt: now,
      })
      .returning()

    if (!thread) throw new Error('Failed to create thread')

    const [message] = await db
      .insert(feedbackMessages)
      .values({
        threadId: thread.id,
        senderType: 'tenant',
        senderUserId: userId,
        body: data.body,
      })
      .returning()

    if (!message) throw new Error('Failed to create feedback message')

    const [tenant] = await db
      .select({ businessName: tenants.businessName })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)

    await notifyAdminsOfNewFeedback({
      threadId: thread.id,
      messageId: message.id,
      tenantId,
      tenantName: tenant?.businessName ?? 'Tenant',
      subject: data.subject,
      body: data.body,
      kind: 'new_thread',
    })

    return thread
  })

// ─── Add reply to existing thread ────────────────────────────────

const addMessageInput = z.object({
  threadId: z.string().uuid(),
  body: z.string().min(1),
})

export const addFeedbackMessage = createServerFn({ method: 'POST' })
  .inputValidator(addMessageInput)
  .handler(async ({ data }) => {
    const { tenantId, userId } = await requireAuth()

    // Verify thread belongs to this tenant
    const [thread] = await db
      .select({
        id: feedbackThreads.id,
        subject: feedbackThreads.subject,
        tenantName: tenants.businessName,
      })
      .from(feedbackThreads)
      .leftJoin(tenants, eq(feedbackThreads.tenantId, tenants.id))
      .where(
        and(
          eq(feedbackThreads.id, data.threadId),
          eq(feedbackThreads.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!thread) throw new Error('Thread tidak ditemukan')

    const now = new Date()
    const [message] = await db
      .insert(feedbackMessages)
      .values({
        threadId: data.threadId,
        senderType: 'tenant',
        senderUserId: userId,
        body: data.body,
      })
      .returning()

    if (!message) throw new Error('Gagal mengirim balasan')

    await db
      .update(feedbackThreads)
      .set({ lastMessageAt: now, updatedAt: now, tenantLastViewedAt: now })
      .where(eq(feedbackThreads.id, data.threadId))

    await notifyAdminsOfNewFeedback({
      threadId: data.threadId,
      messageId: message.id,
      tenantId,
      tenantName: thread.tenantName ?? 'Tenant',
      subject: thread.subject,
      body: data.body,
      kind: 'tenant_reply',
    })

    return message
  })

// ─── List tenant's threads ────────────────────────────────────────

export const listFeedbackThreads = createServerFn().handler(async () => {
  const { tenantId } = await requireAuth()

  return db
    .select()
    .from(feedbackThreads)
    .where(eq(feedbackThreads.tenantId, tenantId))
    .orderBy(desc(feedbackThreads.lastMessageAt))
})

// ─── Get thread + messages ────────────────────────────────────────

const getThreadInput = z.object({ threadId: z.string().uuid() })

export const getFeedbackThread = createServerFn({ method: 'POST' })
  .inputValidator(getThreadInput)
  .handler(async ({ data }) => {
    const { tenantId } = await requireAuth()

    const [thread] = await db
      .select()
      .from(feedbackThreads)
      .where(
        and(
          eq(feedbackThreads.id, data.threadId),
          eq(feedbackThreads.tenantId, tenantId),
        ),
      )
      .limit(1)

    if (!thread) throw new Error('Thread tidak ditemukan')

    await db
      .update(feedbackThreads)
      .set({ tenantLastViewedAt: new Date() })
      .where(eq(feedbackThreads.id, data.threadId))

    const messages = await db
      .select()
      .from(feedbackMessages)
      .where(eq(feedbackMessages.threadId, data.threadId))
      .orderBy(feedbackMessages.createdAt)

    return { thread, messages }
  })

// ─── JUR-148: public /contact submission ─────────────────────────
//
// Unauthenticated entry point. Writes a `source='public'` thread with
// `tenant_id=null`, the submitter's name + email, and the client IP for
// the rate limiter. Admins reply via the existing inbox; the public
// reply path emails the submitter directly (no in-app surface).

const RATE_LIMIT_PER_HOUR = 5
const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const publicSubmitInput = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  email: z.string().trim().email('Email tidak valid').max(254),
  subject: z.string().trim().min(1, 'Subjek wajib diisi').max(200),
  body: z.string().trim().min(10, 'Pesan minimal 10 karakter').max(5000),
  // Hidden honeypot field. Real users leave it empty; bots fill every
  // input by class/name. If non-empty we silently 200 to avoid telling
  // the bot it got caught.
  website: z.string().optional(),
  // Cloudflare Turnstile token. Only verified when TURNSTILE_SECRET_KEY
  // is set so local dev works without a Cloudflare account.
  turnstileToken: z.string().optional(),
})

function extractClientIp(): string | null {
  try {
    const req = getRequest()
    const fwd = req.headers.get('x-forwarded-for')
    if (fwd) {
      // x-forwarded-for can be a comma-separated chain when proxied
      // through multiple hops. The leftmost entry is the real client.
      const first = fwd.split(',')[0]?.trim()
      if (first) return first
    }
    const real = req.headers.get('x-real-ip')
    if (real) return real.trim()
    return null
  } catch {
    return null
  }
}

async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    // Captcha disabled in this environment (dev / preview). Honeypot +
    // rate limit + email validation still apply.
    return true
  }
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
    })
    if (!res.ok) {
      console.error('[contact] turnstile verify HTTP', res.status)
      return false
    }
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (!json.success) {
      console.warn('[contact] turnstile rejected:', json['error-codes'])
    }
    return Boolean(json.success)
  } catch (err) {
    console.error('[contact] turnstile verify threw:', err)
    return false
  }
}

export const submitPublicFeedback = createServerFn({ method: 'POST' })
  .inputValidator(publicSubmitInput)
  .handler(async ({ data }) => {
    // Honeypot caught a bot. Return ok so the bot can't differentiate
    // a success from a silent drop and tune its next attempt.
    if (data.website && data.website.trim().length > 0) {
      return { ok: true as const }
    }

    const ip = extractClientIp()

    const ok = await verifyTurnstile(data.turnstileToken, ip)
    if (!ok) {
      throw new Error('Verifikasi captcha gagal. Coba lagi.')
    }

    if (ip) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(feedbackThreads)
        .where(
          and(
            eq(feedbackThreads.submitterIp, ip),
            sql`${feedbackThreads.createdAt} > now() - interval '1 hour'`,
          ),
        )
      if ((row?.count ?? 0) >= RATE_LIMIT_PER_HOUR) {
        throw new Error(
          'Terlalu banyak pesan dari alamat ini. Coba lagi dalam 1 jam.',
        )
      }
    }

    const now = new Date()

    const [thread] = await db
      .insert(feedbackThreads)
      .values({
        tenantId: null,
        source: 'public',
        subject: data.subject,
        status: 'open',
        publicName: data.name,
        publicEmail: data.email,
        submitterIp: ip,
        lastMessageAt: now,
      })
      .returning()

    if (!thread) throw new Error('Gagal menyimpan pesan')

    const [message] = await db
      .insert(feedbackMessages)
      .values({
        threadId: thread.id,
        senderType: 'public',
        body: data.body,
      })
      .returning()

    if (!message) throw new Error('Gagal menyimpan pesan')

    // Admin notification reuses the existing helper. `tenantId=null` is
    // fine — the notif still fans out to every platform admin with a
    // /admin/feedback deep link; only the in-app feedback-author surface
    // gets skipped (there's no logged-in author).
    await notifyAdminsOfNewFeedback({
      threadId: thread.id,
      messageId: message.id,
      tenantId: null,
      tenantName: `${data.name} (tamu)`,
      subject: data.subject,
      body: data.body,
      kind: 'new_thread',
    })

    return { ok: true as const }
  })
