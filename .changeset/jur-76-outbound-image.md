---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-76 — operator can attach + send images from the chat composer.

- New paperclip button in the composer, opens a file picker scoped
  to image/jpeg, image/png, image/webp.
- 5 MB client-side cap (matches `s3-storage.ts` server-side cap)
  with toast on oversize.
- Pending image preview above the textarea with a remove "X". The
  textarea becomes the image caption when an attachment is present.
- New `sendWaImage` server fn — parses the data URL, uploads to S3
  via `uploadWaMediaOutbound` (added in JUR-77), then POSTs the
  resulting key to the API. Bytes never traverse the API.
- New `POST /v1/wa/instances/:id/messages/image` endpoint validates
  the s3Key starts with `{tenantId}/wa/{instanceId}/` so a malicious
  caller can't reference another tenant's S3 object.
- New `wa:send_image` task handler (mirrors `wa:send` — same rate
  limit, same retry, same idempotency rules) downloads from S3,
  calls `whatsmeow.Client.Upload(MediaImage)`, sends ImageMessage.
- Outbound image bubbles render via the JUR-77 MediaImage component
  immediately after send (status flows pending → sent).
