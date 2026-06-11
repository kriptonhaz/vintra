/**
 * Articles / Guide CMS server functions (issue #206).
 *
 * Admin mutations are gated by `requirePlatformAdmin()`. The two public
 * readers (`listPublishedArticles`, `getPublishedArticle`) take no auth
 * and only ever expose `status = 'published'` rows.
 *
 * Article bodies are stored as HTML. The HTML is sanitized server-side
 * on every write so a stored-XSS payload can never round-trip into the
 * public renderer, even though the author is a trusted platform admin.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { db } from '@vintra/db'
import { articles } from '@vintra/db/schema'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { requirePlatformAdmin } from '../middleware/platform-admin'
import { uploadArticleImage, parseDataUrl } from '@/lib/s3-storage'

// ─── Helpers ─────────────────────────────────────────

function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'h1', 'h2', 'h3', 'h4',
      'ul', 'ol', 'li', 'blockquote', 'hr',
      'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
      'a', 'img',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
    },
    // Inline images are always our own /artikel/media proxy path
    // (relative URLs, which sanitize-html keeps). External http(s) is
    // allowed too in case an admin pastes one deliberately.
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    },
  })
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * Resolves a unique slug. Appends `-2`, `-3`, … on collision. `exceptId`
 * lets an article keep its own slug on update.
 */
async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let candidate = base
  let n = 1
  // Small table — a handful of point lookups is fine.
  while (true) {
    const [row] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.slug, candidate))
      .limit(1)
    if (!row || row.id === exceptId) return candidate
    n += 1
    candidate = `${base}-${n}`
  }
}

// ─── Shared input shape ──────────────────────────────

const articleInput = {
  title: z.string().min(1, 'Judul wajib diisi').max(200),
  slug: z.string().max(120).optional(),
  excerpt: z.string().max(300).optional(),
  content: z.string().default(''),
  coverImageKey: z.string().max(120).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(300).nullable().optional(),
}

// ─── Admin: list + detail ────────────────────────────

export const listArticlesAdmin = createServerFn().handler(async () => {
  await requirePlatformAdmin()
  return db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      category: articles.category,
      status: articles.status,
      coverImageKey: articles.coverImageKey,
      viewCount: articles.viewCount,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .orderBy(desc(articles.updatedAt))
})

export const getArticleAdmin = createServerFn()
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [row] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, data.id))
      .limit(1)
    if (!row) throw new Error('Artikel tidak ditemukan')
    return row
  })

// ─── Admin: create / update ──────────────────────────

export const createArticle = createServerFn({ method: 'POST' })
  .inputValidator(z.object(articleInput))
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()
    const base = slugify(data.slug || data.title)
    if (!base) throw new Error('Judul tidak bisa dijadikan slug')
    const slug = await uniqueSlug(base)

    const [row] = await db
      .insert(articles)
      .values({
        slug,
        title: data.title.trim(),
        excerpt: data.excerpt?.trim() || null,
        content: sanitizeArticleHtml(data.content),
        coverImageKey: data.coverImageKey || null,
        category: data.category?.trim() || null,
        seoTitle: data.seoTitle?.trim() || null,
        seoDescription: data.seoDescription?.trim() || null,
        authorUserId: auth.userId,
      })
      .returning({ id: articles.id })
    return { id: row!.id }
  })

export const updateArticle = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid(), ...articleInput }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [existing] = await db
      .select({ id: articles.id, slug: articles.slug })
      .from(articles)
      .where(eq(articles.id, data.id))
      .limit(1)
    if (!existing) throw new Error('Artikel tidak ditemukan')

    const base = slugify(data.slug || data.title)
    if (!base) throw new Error('Judul tidak bisa dijadikan slug')
    const slug = await uniqueSlug(base, data.id)

    await db
      .update(articles)
      .set({
        slug,
        title: data.title.trim(),
        excerpt: data.excerpt?.trim() || null,
        content: sanitizeArticleHtml(data.content),
        coverImageKey: data.coverImageKey || null,
        category: data.category?.trim() || null,
        seoTitle: data.seoTitle?.trim() || null,
        seoDescription: data.seoDescription?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, data.id))
    return { id: data.id }
  })

// ─── Admin: status transitions ───────────────────────

export const publishArticle = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const [existing] = await db
      .select({ publishedAt: articles.publishedAt })
      .from(articles)
      .where(eq(articles.id, data.id))
      .limit(1)
    if (!existing) throw new Error('Artikel tidak ditemukan')
    await db
      .update(articles)
      .set({
        status: 'published',
        // Stamp publishedAt only the first time — re-publishing keeps
        // the original publish date.
        publishedAt: existing.publishedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(articles.id, data.id))
    return { id: data.id }
  })

export const unpublishArticle = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(articles)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(articles.id, data.id))
    return { id: data.id }
  })

export const archiveArticle = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    await db
      .update(articles)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(articles.id, data.id))
    return { id: data.id }
  })

// ─── Admin: image upload (TipTap + cover) ────────────

export const uploadArticleImageFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ dataUrl: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()
    const { bytes, mimeType } = parseDataUrl(data.dataUrl)
    if (!mimeType.startsWith('image/')) {
      throw new Error('File harus berupa gambar')
    }
    const { mediaId } = await uploadArticleImage({ bytes, mimeType })
    return { mediaId, url: `/artikel/media/${mediaId}` }
  })

// ─── Public readers ──────────────────────────────────

export const listPublishedArticles = createServerFn().handler(async () => {
  return db
    .select({
      slug: articles.slug,
      title: articles.title,
      excerpt: articles.excerpt,
      category: articles.category,
      coverImageKey: articles.coverImageKey,
      publishedAt: articles.publishedAt,
    })
    .from(articles)
    .where(eq(articles.status, 'published'))
    .orderBy(desc(articles.publishedAt))
})

export const getPublishedArticle = createServerFn()
  .inputValidator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.slug, data.slug), eq(articles.status, 'published')))
      .limit(1)
    if (!row) return null

    // Best-effort view counter — never block the read on it.
    await db
      .update(articles)
      .set({ viewCount: sql`${articles.viewCount} + 1` })
      .where(eq(articles.id, row.id))

    // Up to 4 related articles in the same category (newest first).
    const related = row.category
      ? await db
          .select({
            slug: articles.slug,
            title: articles.title,
            excerpt: articles.excerpt,
            coverImageKey: articles.coverImageKey,
            publishedAt: articles.publishedAt,
          })
          .from(articles)
          .where(
            and(
              eq(articles.status, 'published'),
              eq(articles.category, row.category),
              ne(articles.id, row.id),
            ),
          )
          .orderBy(desc(articles.publishedAt))
          .limit(4)
      : []

    return { article: row, related }
  })
