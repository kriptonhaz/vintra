---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-185 — Subdomain MVP: `<slug>.vintra.my.id` queue page for cuci motor.

**Why this exists.** A cuci motor tenant is waiting on the JUR-167 queue feature and asked for a public-facing URL their customers can share to check the live queue before driving over — and they want it on a subdomain so the URL itself doubles as a marketing artifact for Vintra. The full Tenant Public Site project (JUR-175 wildcard infra + JUR-176 template editor + JUR-177 public rendering + JUR-178 booking sub-route) is a multi-week epic. This ticket is an intentional MVP wedge that ships the highest-value piece (live queue page on a subdomain) in one commit, deferring the templated landing/editor/SEO work until more tenants ask.

**Migration 0065 (applied to prod):**

```sql
ALTER TABLE tenants ADD COLUMN public_slug text;
CREATE UNIQUE INDEX tenants_public_slug_unique_idx
  ON tenants (public_slug) WHERE public_slug IS NOT NULL;
```

Partial unique index — null is allowed (most tenants haven't claimed), only claimed slugs collide. Distinct from the existing `tenants.slug` (auto-generated owner identifier, URL-unfriendly). `public_slug` is the tenant-chosen vanity component.

**Server fns** — new `apps/web/src/server/functions/public-tenant.ts`:

- **`claimPublicSlug({ slug })`** — gated on `booking.write`. Validates regex `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` (3-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen). Blocks ~70 reserved slugs (admin, api, app, www, dashboard, login, all SaaS module paths, brand terms, common test/dev names). Friendly Indonesian errors for each rejection class. Uniqueness enforced by the partial index; the redundant explicit check just gives a better error message.
- **`getMyPublicSlug()`** — auth-gated read for the settings UI ("what's my current slug?").
- **`getPublicQueueData({ slug })`** — **NO AUTH**. Tightly-scoped public read. Returns only safe fields: tenant business name + slug, branches (name/address/business_hours only — no lat/long), bookable services (name/price/color/duration), queue snapshot stripped to `{ resourceId, ticketNumber, firstName, status }` — phone numbers, customer ids, notes, full last names, all withheld. Returns null when no tenant matches → route renders 404.

**Public route** — new `apps/web/src/routes/q.$slug.tsx`:

- Mobile-first single-column layout (customers will hit this from phones while in transit).
- No auth, no `_authed/` layout, no sidebar / navbar — pure tenant-facing public surface.
- Polls `getPublicQueueData` every 15s via `refetchInterval` for live queue updates. No WebSocket needed for v1; 15s feels live enough at cuci motor speed.
- Mode-aware:
  - `mode='queue'` → big queue card with per-resource columns, large queue counts ("**3** antrian"), animated LIVE indicator, in-progress ticket call-out.
  - `mode='slot'` or other → simpler "Datang langsung atau hubungi" card (queue card hidden, not broken).
- Open/closed indicator from `branches.business_hours` for today's day-of-week.
- Services list with price + duration + color swatch.
- Full week hours grid (only rendered when business_hours configured).
- Footer: "Powered by Vintra" link → marketing channel for inbound tenants.
- 404 component for unclaimed slugs.

**Settings UI** — new `PublicSlugSection` card in `/booking/settings`:

- Read-only display when slug is claimed: full URL preview with copy + open-in-new-tab buttons.
- Edit mode with input + Klaim button when unclaimed or re-claiming.
- Local regex check for instant feedback as the user types.
- Help text + amber warning copy when re-claiming an existing slug (old links break).
- 10 new i18n keys in id + en.

**Nginx vhost** — new `deploy/nginx/public-tenant.conf`:

- Matches `~^(?<sub>[a-z0-9][a-z0-9-]{1,28}[a-z0-9])\.vintra\.com$` via regex. Existing exact-match vhosts (`vintra.my.id`, `api.vintra.my.id`) have higher specificity so they catch their own hostnames first — only OTHER subdomains hit this vhost.
- Internal rewrite: `<sub>.vintra.my.id/<path>` → `/q/<sub>/<path>` via `rewrite ... break`. Browser URL bar stays at the subdomain (this is proxy_pass, not 301).
- Static assets (`/_build`, `/assets`, `/images`, `/fonts`, favicons) served directly from `dist/client` without the rewrite — same paths work across all subdomains because we have one app build.
- SSL via Cloudflare Origin Certificate (15-year, zero-renewal) — runbook explains setup.

**Deploy runbook** — new `deploy/SUBDOMAIN-DEPLOY.md`:

End-to-end one-shot runbook covering:
1. **DNS migration to Cloudflare** (one-time, ~30 min + propagation window): sign up, add site, verify record import, flip nameservers at Hostinger, add wildcard A record with proxy ON.
2. **SSL via Cloudflare Origin Certificate**: generate in CF dashboard, copy to `/etc/ssl/cloudflare/`, set CF SSL mode to Full (strict).
3. **Nginx vhost install**: scp + symlink + nginx -t + reload.
4. **App deploy**: standard `./deploy.sh web`.
5. **Smoke test**: claim a test slug, visit subdomain, verify 404 path.
6. **Troubleshooting table** for common SSL / vhost / asset issues.
7. **Optional hardening section** for Cloudflare IP allowlisting + WAF (defer until prod abuse seen).

**Out of scope** (intentional defers):

- Customer self-join queue from the public page → needs honeypot + rate limit + WA verification. Defer until usage proves the demand.
- Branded look, photos, template editor → JUR-176 territory. v1 ships a clean default style.
- SEO meta tags / OpenGraph cards → JUR-177 territory. v1 has basic `<title>` only.
- Custom domains → JUR-179.
- Multiple sub-pages (`/menu`, `/about`) on the subdomain → root only for v1.
- Slot-mode-specific public booking flow → JUR-178 builds the full mode-aware booking UI under the same subdomain story.

**Future relation to the full project.** Every piece here is intentionally replaceable when JUR-175-178 ship: the slug column migrates to whatever JUR-175 designs for subdomain claim, the queue page either absorbs into JUR-178's `/book` mode-aware route or stays as a permanent `/q` shortcut. The MVP doesn't paint us into a corner.

**Acceptance criteria** (verified by typecheck + spec walkthrough; smoke test required after deploy):

1. Tenant claims slug `cuci-mantra` from `/booking/settings` → preview URL appears.
2. Visit `cuci-mantra.vintra.my.id` (after DNS + nginx deployed) → mobile-first queue page with live counts, polls every 15s.
3. Visit `unclaimed-slug.vintra.my.id` → 404 page (not a crash, not the SaaS app).
4. Reserved slug (`admin`, `pos`, etc.) → validation error in claim form.
5. Duplicate slug claim → uniqueness rejection.
6. `/q/cuci-mantra` path also works (the internal route that nginx rewrites subdomain requests to).

Typecheck green. Migration applied to prod.
