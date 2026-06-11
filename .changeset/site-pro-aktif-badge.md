---
"@vintra/web": patch
---

JUR-176: show Situs as Pro-locked for free tenants, Aktif for
Komplit — matches the existing convention for paid modules.

- MODULE_NAV Situs entry switches `module: 'booking'` → `module:
  'site'` and drops its top-level `feature` filter, so it's always
  visible in the sidebar.
- `moduleStatusFor('site')` returns `'paid'` when the POS sub
  carries the `tenant_site` flag (Komplit only) — green "Aktif"
  pill. Otherwise `'locked'` — amber "Pro" pill with lock icon.
- New `/site/locked` route — Komplit upsell with three feature
  highlight cards (Editor modular / URL khusus / Analitik
  kunjungan) and CTA to /pricing. Komplit tenants who hit this
  page get bounced to /site/edit.
- Route guards on /site/edit + /site/analytics now redirect
  non-Komplit tenants to /site/locked instead of /dashboard, so the
  click lands somewhere useful for the upgrade flow.
