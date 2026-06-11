---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-75 — inbound WhatsApp media (image / sticker / document / video / audio)
gets downloaded, decrypted, and uploaded to S3 as it arrives.

- New schema columns on `wa_messages`: `media_mime`, `media_size_bytes`
  alongside the existing `media_key` (now actually populated).
- New Go S3 client wrapper at `apps/api/internal/storage/s3.go`.
  Uses `aws-sdk-go-v2`, reads the same `AWS_REGION` /
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET`
  env the web app already needs. Optional at boot — missing creds
  log a warn and inbound media silently passes through with
  `media_key=NULL`.
- Provider's inbound subscriber synchronously downloads via
  `whatsmeow.Client.Download()`, uploads to S3 with key
  `{tenantId}/wa/{instanceId}/{externalId}.{ext}` and tag
  `kind=wa-media` (drives the future 3-day lifecycle from JUR-79).
- `wa:incoming` worker writes the three media columns alongside
  the existing `type` and `body` (caption) fields.
- Failure handling: download timeout / S3 error logs warn and
  persists the row with empty media_key so chat history still
  shows the message — JUR-77 will render "Media tidak tersedia".
