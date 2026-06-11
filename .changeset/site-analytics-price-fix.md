---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-176 follow-ups: analytics dashboard + services price fix.

**Analytics** (`/site/analytics`):

- New table `tenant_site_views` (migration 0067) — one row per page
  load, keyed by tenant + viewed_at + visitor_hash + path + referrer.
- `recordSiteView` fires from both SSR entry points (subdomain
  index loader + `/q/$slug` loader), keyed off Cloudflare's
  `cf-connecting-ip` so refresh spam from one IP collapses to a
  single unique-visitor for the day. The 15-second polling client
  omits a new `track` flag on `getPublicQueueData` so polls don't
  inflate the visit count by 5760×.
- Dashboard at `/site/analytics` with range picker (7/14/30/90d),
  three stat cards (today / range total / unique visitors), a
  CSS-only daily bar chart (no library), and a top-10 referrers
  list. Bucketed by Jakarta date.
- Sidebar: new "Analitik" sub-entry under Situs.
- Private `_tenantId` field stripped from the public renderer's
  response so anonymous visitors never see tenant ids.

**Price fix**: services on the public site were showing Rp 0 because
the Drizzle correlated subquery `${inventoryItems.id}` inside a
`sql` template returned '0' instead of the outer-row reference.
Replaced with a separate pricing query + JS merge — one extra
roundtrip, zero subquery weirdness. Same fix in
`getEditorPreviewData` (editor preview) and
`fetchPublicQueueDataForSlug` (public renderer).
