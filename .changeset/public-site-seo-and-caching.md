---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Add SEO + edge caching to the public tenant site (JUR-177, part 1).

A claimed `{slug}.vintra.my.id` already renders the tenant's published site, but its `<head>` only carried a title and the HTML was never edge-cached. This adds:

- Per-tenant `<title>`, meta description, Open Graph + Twitter card tags from the published `settings.seo`, plus a `LocalBusiness` JSON-LD block. Unpublished / maintenance sites emit `robots: noindex`.
- Published tenant pages send `Cache-Control: s-maxage=300, stale-while-revalidate=600` so Cloudflare edge-caches them for 5 minutes. Publishing or toggling maintenance fires a best-effort Cloudflare cache purge so edits appear immediately. New env: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` (purge is a logged no-op when unset).

The remaining JUR-177 scope — per-tenant robots.txt / sitemap.xml and a performance pass — is tracked as follow-ups.
