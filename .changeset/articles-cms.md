---
"@vintra/web": minor
"@vintra/db": minor
---

Add an admin-authored Articles / Guide CMS (issue #206). Platform admins write guide articles in a TipTap WYSIWYG editor under `/admin/articles` — title, slug, cover image, category, SEO fields, rich body with inline images — and publish them to public, SEO-friendly pages at `/artikel` and `/artikel/:slug`.

Article images are stored in S3 and served through a stable, Cloudflare-cacheable `/artikel/media/:mediaId` proxy route, so stored article HTML embeds permanent URLs (no expiring signed URLs). Article bodies are sanitized server-side on every write. Removed articles are archived, not deleted. New `articles` table (migration `0087`).
