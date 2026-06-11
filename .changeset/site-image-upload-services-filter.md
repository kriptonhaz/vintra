---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-176 follow-ups:

- Services list on the public site no longer requires
  `is_bookable=true`. A jasa-only tenant (cuci motor) can now surface
  POS items (e.g. instant noodles for waiting customers) alongside
  their bookable services. Filter is now simply
  `is_sellable AND is_active`.
- Wire S3 image upload for tenant-site assets:
  - `uploadTenantSiteAsset` / `getTenantSiteAssetSignedUrl` /
    `deleteTenantSiteAsset` / `parseTenantSiteAssetKey` helpers tagged
    `kind=tenant-site`. Key layout
    `{tenantId}/site/{kind}/{assetId}.{ext}`; single-slot kinds
    (logo/og) overwrite, gallery accumulates by uuid.
  - `uploadSiteAsset` server fn bridges the editor's `PhotoUploadField`
    to S3 — `booking.write` gated, parses data URLs, returns the key.
  - Public renderer pre-signs every image key declared by the
    published template's schema and ships the map in the response;
    editor preview signs the in-progress draft. Templates'
    `resolveAssetUrl()` is now a real lookup, not a placeholder.
- Replace the "Coming Soon" placeholder in the editor's image field
  with the real `PhotoUploadField`, including client-side
  compression + immediate preview update via a local URL cache.
