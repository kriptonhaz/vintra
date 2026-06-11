---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-176 Phase 2: tenant public-site template engine + editor.

- New `tenant_sites` table (1-row-per-tenant, with co-resident draft +
  published settings blobs and template id) and `site_publish_history`
  (append-only, trimmed to last 5 per tenant) — migration 0066.
- Registry-driven template engine in
  `apps/web/src/lib/site-templates/` with shared section schemas
  (header/about/modules/contact/seo), shared module components
  (Header, About, Queue, Services, Hours, Branches, Contact, Footer),
  and 5 starter templates: Mini, Warung Modern, Toko Retail, Salon /
  Jasa, Kafe / Resto. Each renders a visibly distinct hero so the
  picker preview communicates "this is a different look" at a glance.
- `/site/edit` editor route with template picker, sectioned form
  generated from the active template's field schema, inline live
  preview, Simpan Draft + Publikasikan, and a publish history list
  with Pulihkan (rolls a snapshot back into the draft — never
  auto-republishes).
- Public renderer (`PublicSitePage`) replaces `PublicQueuePage` on
  index + `/q/$slug` routes; falls back to the JUR-185 baseline queue
  view for tenants who haven't published yet, so no regression for
  the cuci motor customer already live at `mantra.vintra.my.id`.
- Sidebar: "Situs" promoted to its own top-level entry (Globe icon)
  instead of being nested under Booking.

Permission gate stays on `booking.write` for v1 — the slug claim from
JUR-185 already lives there. A dedicated `site.write` permission can
be split out later without touching the editor or template code.

Image upload widget renders a "Coming Soon" placeholder until the S3
wrapping for `tenant-site` assets ships in a follow-up. Logo / hero /
OG image fields save the asset key but the renderer skips the `<img>`
tag when no URL resolves.
