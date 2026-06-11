import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Platform-global guide / blog articles (issue #206). No tenant_id —
 * these are Vintra's own content, authored by platform admins in the
 * admin panel and read publicly at /artikel.
 *
 * `content` is sanitized HTML produced by the TipTap editor. Images
 * (cover + inline) are stored in S3 and referenced through the
 * /artikel/media/{mediaId} proxy route, so the HTML embeds stable URLs.
 */
export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    content: text('content').notNull().default(''),
    /** Cover image media id (`{uuid}.{ext}`) — null when no cover set. */
    coverImageKey: text('cover_image_key'),
    category: text('category'),
    /** draft | published | archived — enforced by a DB CHECK. */
    status: text('status').notNull().default('draft'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    /** Supabase auth user id of the admin who created the article. */
    authorUserId: uuid('author_user_id'),
    /** Set the first time the article transitions to published. */
    publishedAt: timestamp('published_at'),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('articles_status_published_at_idx').on(t.status, t.publishedAt),
    check(
      'articles_status_chk',
      sql`${t.status} IN ('draft', 'published', 'archived')`,
    ),
  ],
)
