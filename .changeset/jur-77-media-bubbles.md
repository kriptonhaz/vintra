---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-77 — render WhatsApp media in chat bubbles (image, sticker,
document) using lazy-fetched signed S3 URLs.

- New `getWaMediaUrl({messageId})` server fn — validates tenant
  scope via the API, then signs a 5-minute URL via the existing
  `s3-storage.ts` helper. Returns null for missing/expired media.
- New `GET /v1/wa/messages/:id` API endpoint (tenant-scoped) so the
  signing fn can verify ownership before touching S3.
- New bubble variants: image (with click-to-zoom lightbox), sticker
  (chrome-free, 120×120), document (icon + size + open in new tab).
- React Query caches the signed URL for 4 minutes (TTL minus a
  1-min safety margin).
- Fallback "Media tidak tersedia" rendered when S3 returns 404
  (3-day lifecycle elapsed) or when the inbound download failed.
- New `getWaMediaSignedUrl()` helper in `s3-storage.ts` plus a
  `uploadWaMediaOutbound()` helper ready for JUR-76 outbound send.
- `messageResp` API shape gains `mediaKey` / `mediaMime` /
  `mediaSizeBytes` so the bubble component knows how to render
  without a second round-trip.
