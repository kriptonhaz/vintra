-- JUR-75: per-message media metadata for image / sticker / document
-- inbound + outbound. media_key already exists (set by JUR-45 plan but
-- never populated); we just add the mime + size columns alongside it.
--
-- All three columns are NULL for text-only messages.
-- All three columns may be NULL for media we failed to download/upload
-- (whatsmeow socket flap or S3 outage) — UI shows
-- "Media tidak tersedia" in that case.
ALTER TABLE wa_messages
  ADD COLUMN media_mime text,
  ADD COLUMN media_size_bytes integer;
