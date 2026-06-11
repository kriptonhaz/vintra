---
"@vintra/web": minor
"@vintra/shared": minor
"@vintra/db": patch
---

JUR-176: gate the Situs feature behind the Komplit bundle.

- New `tenant_site` POS feature flag, included in
  `POS_KOMPLIT_FEATURES`. Free / Toko / Bisnis / Multi-Outlet do
  NOT have it.
- `requireTenantSiteAccess()` middleware (combines POS access check
  + `tenant_site` feature flag). Applied to every editor server fn
  in `tenant-site.ts` (7 entry points), the analytics dashboard fn,
  and the slug claim in `public-tenant.ts`.
- Public read path (`fetchPublicQueueDataForSlug`) now checks the
  tenant's tier via `getTenantSiteAccessForTenantId()`. Tenants who
  downgrade have their public URL go dark (404) — closes the
  "publish, cancel, keep using" loop.
- Sidebar: `MODULE_NAV` filter now honors `item.feature`. Situs
  entry carries `feature: 'tenant_site'` so free tenants don't see
  it at all. `NavItem.feature` type added.
- Route guards: `/site/edit` + `/site/analytics` both
  `beforeLoad`-redirect free tenants to `/dashboard`.
- `/booking/settings` slug card swaps to a Komplit upsell card for
  free tenants. Existing claimed slug is preserved in the
  "tetap tersimpan" message so a tenant who downgrades knows they
  can re-activate without losing their URL.
