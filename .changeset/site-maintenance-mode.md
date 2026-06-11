---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-176: maintenance mode (under-construction page) for tenant sites.

- Migration 0068 adds `maintenance_mode boolean` (default false) +
  `maintenance_message text` to `tenant_sites`.
- New `setSiteMaintenanceMode` server fn is **independent of the
  publish flow** — toggling on/off doesn't require re-publishing
  settings. The `published_settings` snapshot stays intact so
  flipping back to false instantly restores whatever was live.
- Public read (`fetchPublicQueueDataForSlug`) checks the flag first
  and short-circuits to a `maintenance: { active, message, brandColor }`
  marker. No inventory / queue / branches / analytics work when the
  site is offline.
- New `SiteMaintenancePage` component — branded centered page that
  picks up `published_settings.theme.brandColor` so the offline
  state still feels like the tenant's. Shows the custom message or
  a localized default.
- Editor: new "Status Situs" card at the top with toggle + optional
  custom message textarea (saves on blur).
