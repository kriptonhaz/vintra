/**
 * Pengumuman (announcements) — tenant broadcasts to staff.
 *
 * Pengumuman is its OWN channel, separate from the notification bell
 * (which is for system notifications). Per-user read state lives in
 * `announcement_reads` — one row once a user opens an announcement;
 * absence = unread. Publishing does NOT fan out notifications.
 *
 * audience is always 'all' (every member) for now and create publishes
 * immediately. Branch targeting + drafts remain future work.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { announcements, announcementReads } from '@vintra/db/schema'
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { requireAuth, requirePermission } from '../middleware/auth'

const MANAGE = 'announcements.manage'

// ─── Read-side (any authenticated member) ────────────────────────────

const listInput = z
  .object({ limit: z.number().int().min(1).max(50).default(20) })
  .optional()

/**
 * Published, non-expired announcements for the caller's tenant, pinned
 * first then newest. Left-joins the caller's read row so the UI can
 * highlight unread items (`readAt === null`).
 */
export const listAnnouncements = createServerFn({ method: 'POST' })
  .inputValidator(listInput)
  .handler(async ({ data }) => {
    const { userId, tenantId } = await requireAuth()
    const limit = data?.limit ?? 20

    const rows = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        pinned: announcements.pinned,
        publishedAt: announcements.publishedAt,
        readAt: announcementReads.readAt,
      })
      .from(announcements)
      .leftJoin(
        announcementReads,
        and(
          eq(announcementReads.announcementId, announcements.id),
          eq(announcementReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(announcements.tenantId, tenantId),
          eq(announcements.status, 'published'),
          or(
            isNull(announcements.expiresAt),
            gt(announcements.expiresAt, new Date()),
          ),
        ),
      )
      .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
      .limit(limit)

    return rows
  })

const idInput = z.object({ id: z.string().uuid() })

/**
 * Single announcement (tenant-scoped, published). Side effect: records
 * the caller's read row so opening it clears the unread highlight.
 */
export const getAnnouncement = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const { userId, tenantId } = await requireAuth()

    const [row] = await db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.id, data.id),
          eq(announcements.tenantId, tenantId),
          eq(announcements.status, 'published'),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Pengumuman tidak ditemukan')

    await db
      .insert(announcementReads)
      .values({ tenantId, announcementId: row.id, userId })
      .onConflictDoNothing()

    return row
  })

// ─── Manage-side (announcements.manage) ──────────────────────────────

const writeFields = {
  title: z.string().trim().min(1, 'Judul wajib diisi').max(160),
  body: z.string().trim().min(1, 'Isi pengumuman wajib diisi').max(5000),
  pinned: z.boolean().optional().default(false),
  /** ISO datetime; null/omitted = never expires. */
  expiresAt: z.string().datetime().nullable().optional(),
}

const createInput = z.object(writeFields)

/** Create + publish immediately. No notification fan-out — Pengumuman
 *  surfaces in the home card + list screen, read-tracked on open. */
export const createAnnouncement = createServerFn({ method: 'POST' })
  .inputValidator(createInput)
  .handler(async ({ data }) => {
    const { userId, tenantId } = await requirePermission(MANAGE)

    const [created] = await db
      .insert(announcements)
      .values({
        tenantId,
        authorUserId: userId,
        title: data.title,
        body: data.body,
        audience: 'all',
        pinned: data.pinned ?? false,
        status: 'published',
        publishedAt: new Date(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      })
      .returning()
    if (!created) throw new Error('Gagal membuat pengumuman')

    return created
  })

const updateInput = z.object({ id: z.string().uuid(), ...writeFields })

/** Edit an existing announcement (title/body/pin/expiry). */
export const updateAnnouncement = createServerFn({ method: 'POST' })
  .inputValidator(updateInput)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission(MANAGE)

    const [updated] = await db
      .update(announcements)
      .set({
        title: data.title,
        body: data.body,
        pinned: data.pinned ?? false,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(announcements.id, data.id), eq(announcements.tenantId, tenantId)),
      )
      .returning()
    if (!updated) throw new Error('Pengumuman tidak ditemukan')
    return updated
  })

const adminListInput = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .optional()

/** Paginated list of all tenant announcements (any status), newest first. */
export const listAnnouncementsAdmin = createServerFn({ method: 'POST' })
  .inputValidator(adminListInput)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission(MANAGE)
    const page = data?.page ?? 1
    const pageSize = data?.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const [items, totalRow] = await Promise.all([
      db
        .select()
        .from(announcements)
        .where(eq(announcements.tenantId, tenantId))
        .orderBy(desc(announcements.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(announcements)
        .where(eq(announcements.tenantId, tenantId)),
    ])

    return { items, total: totalRow[0]?.count ?? 0, page, pageSize }
  })

/** Delete an announcement; announcement_reads cascade on delete. */
export const deleteAnnouncement = createServerFn({ method: 'POST' })
  .inputValidator(idInput)
  .handler(async ({ data }) => {
    const { tenantId } = await requirePermission(MANAGE)
    await db
      .delete(announcements)
      .where(
        and(eq(announcements.id, data.id), eq(announcements.tenantId, tenantId)),
      )
    return { ok: true }
  })
