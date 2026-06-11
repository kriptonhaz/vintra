---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Finish the public tenant site: robots.txt / sitemap.xml, failure fallback, image perf (JUR-188 + JUR-189).

- **robots.txt / sitemap.xml** — new per-subdomain server routes. A published tenant site is crawlable and advertises its sitemap; a draft / maintenance / unclaimed subdomain is `Disallow: /` and its sitemap 404s, so half-built sites never get indexed.
- **Failure handling** — a claimed tenant subdomain whose data fetch fails now renders a calm branded "Situs sedang gangguan" page instead of a raw 500.
- **Performance** — below-the-fold section images (`about`) lazy-load; the hero's first slide loads eagerly with a high fetch-priority hint while later carousel slides defer.
