---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

POS promos: optional banner image, attached automatically to the
WhatsApp AI's reply when it mentions the matching promo.

- DB: new `tenant_promotions.image_key` (nullable text). Migration
  0051. Idempotent.
- S3: `uploadPromoImage` / `getPromoImageSignedUrl` / `deletePromoImage`
  helpers — tag `kind=promo` so the wa-media 24h lifecycle skips it.
  Path `<tenantId>/promos/<promoId>.<ext>`.
- POS promo CRUD (`/pos/promos`): file picker on the create/edit
  Sheet, signed thumbnail in the list, "remove image" affordance.
  Image side-effects run AFTER the row write so a half-saved image
  never wipes the underlying promo data.
- Go RAG retriever: promo snippet now carries one `Attachment` per
  active promo with an image (name + S3 key).
- Go AI reply path (`ai_reply.go`): after the AI generates text, scan
  the reply for any promo name from `Attachments` (case-insensitive
  substring), create an outbound `wa_messages` row with `media_key`
  set to the promo image, and enqueue `wa:send_image`. Customer gets
  the banner right after the text. De-duplicates by image key so the
  same banner isn't sent twice.

Failure-mode notes: image enqueue failures are logged but never
abort the text reply (text already shipped); fuzzy-match is
deliberately loose because promo names are usually distinctive
("HEMAT20", "Diskon Lebaran") rather than common Indonesian words.
