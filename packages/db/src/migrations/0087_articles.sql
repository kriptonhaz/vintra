CREATE TABLE IF NOT EXISTS "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content" text DEFAULT '' NOT NULL,
	"cover_image_key" text,
	"category" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"author_user_id" uuid,
	"published_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "articles_status_chk" CHECK ("status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_status_published_at_idx" ON "articles" USING btree ("status","published_at");

-- Rollback: DROP TABLE IF EXISTS "articles";
