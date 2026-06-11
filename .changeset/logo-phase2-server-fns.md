---
"@vintra/web": minor
---

Logo AI Phase 2 — server functions. Admin CRUD for logo prompt fields / options / template (`admin-logo-fields.ts`) plus the tenant-facing flow in `logo.ts`: `getLogoStatus`, `getLogoPromptConfig`, `listLogos`, `generateLogo` (text-to-image via Gemini — no source upload), `getLogoDownloadUrl`, `deleteLogo`. Generation deducts from the shared Konten credit pool. The Gemini client and `getDefaultImageProvider` are reused; the image client now treats `sourceImage` as optional so the same call site serves both photo enhancement and text-to-image logos. Logos land in S3 under `<tenantId>/logos/<logoId>.<ext>`.
