-- name: CreateOutboundMessage :one
-- Inserts an outbound (fromMe=true) message row in 'pending' status.
-- The send worker (JUR-67) flips it to 'sent' / 'failed' after the
-- whatsmeow call returns.
INSERT INTO wa_messages (tenant_id, instance_id, remote_jid, type, body, from_me, status)
VALUES ($1, $2, $3, $4, $5, true, 'pending')
RETURNING *;

-- name: GetWaMessage :one
SELECT * FROM wa_messages WHERE id = $1 LIMIT 1;

-- name: MarkMessageSent :exec
UPDATE wa_messages
SET status = 'sent', external_id = $2
WHERE id = $1;

-- name: MarkMessageFailed :exec
UPDATE wa_messages
SET status = 'failed', error_message = $2
WHERE id = $1;

-- name: ListMessagesForConversation :many
-- Conversation tail by (instance, jid), newest-first. The hot read
-- path for the inbox UI.
--
-- The query joins the contact's alternate JID (PN<->LID pair) so
-- legacy messages stored under one form still show up when the caller
-- queries with the other form. Without this, switching whatsmeow
-- between LID-mode and PN-mode for the same identity would fragment
-- the conversation across two threads in the UI.
SELECT m.* FROM wa_messages m
WHERE m.instance_id = $1
  AND (
    m.remote_jid = $2
    OR m.remote_jid IN (
      SELECT lid_jid FROM wa_contacts
      WHERE instance_id = $1 AND remote_jid = $2 AND lid_jid IS NOT NULL
    )
    OR m.remote_jid IN (
      SELECT remote_jid FROM wa_contacts
      WHERE instance_id = $1 AND lid_jid = $2
    )
  )
ORDER BY m.created_at DESC
LIMIT $3;

-- name: CreateInboundMessage :one
-- Inserts an inbound (fromMe=false) message. Used by the inbound
-- worker (JUR-68). external_id is set so resync re-emits dedupe at
-- the DB level even if the Redis SADD entry expired.
-- media_key/mime/size are NULL for text-only messages and for media
-- the provider failed to download (JUR-75).
INSERT INTO wa_messages (
  tenant_id, instance_id, remote_jid, external_id, type, body,
  media_key, media_mime, media_size_bytes,
  from_me, status
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'delivered')
RETURNING *;

-- name: UpsertWaContact :exec
-- Used by the inbound worker for messages FROM the contact (fromMe=false).
-- Increments unread_count so the chat UI can render the unread badge.
-- COALESCE on push_name + lid_jid so we never clobber a known value
-- with NULL on a later message that didn't include it.
INSERT INTO wa_contacts (tenant_id, instance_id, remote_jid, lid_jid, push_name, last_message_at, unread_count)
VALUES ($1, $2, $3, $4, $5, now(), 1)
ON CONFLICT (instance_id, remote_jid)
DO UPDATE SET
  lid_jid = COALESCE(EXCLUDED.lid_jid, wa_contacts.lid_jid),
  push_name = COALESCE(EXCLUDED.push_name, wa_contacts.push_name),
  last_message_at = EXCLUDED.last_message_at,
  unread_count = wa_contacts.unread_count + 1,
  updated_at = now();

-- name: UpsertWaContactEcho :exec
-- Used by the inbound worker for messages sent FROM other linked
-- devices on the same WhatsApp account (fromMe=true). Updates
-- last_message_at but does NOT increment unread_count — the user
-- already saw the message on the device they sent it from.
INSERT INTO wa_contacts (tenant_id, instance_id, remote_jid, lid_jid, last_message_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (instance_id, remote_jid)
DO UPDATE SET
  lid_jid = COALESCE(EXCLUDED.lid_jid, wa_contacts.lid_jid),
  last_message_at = EXCLUDED.last_message_at,
  updated_at = now();

-- name: CreateInboundEcho :one
-- Persists a message echoed back from another linked device of the
-- same WhatsApp account. fromMe=true, status='sent'. external_id is
-- set so future resync re-emits dedupe at the DB level if the Redis
-- TTL has rolled. Media fields mirror CreateInboundMessage so an
-- echo of an image you sent from your phone still has the bytes.
INSERT INTO wa_messages (
  tenant_id, instance_id, remote_jid, external_id, type, body,
  media_key, media_mime, media_size_bytes,
  from_me, status
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'sent')
RETURNING *;

-- name: ListConversationTail :many
-- Returns the N most recent messages for an (instance, jid) pair,
-- newest-first. The conversation loader reverses the slice so the
-- AI prompt is in chronological order. Only 3 columns are fetched
-- to keep the payload small — body/from_me/created_at is all the
-- prompt builder needs.
SELECT from_me, body, created_at
FROM wa_messages
WHERE instance_id = $1 AND remote_jid = $2
ORDER BY created_at DESC
LIMIT $3;

-- name: CreateOutboundAiMessage :one
-- Inserts an AI-generated outbound message, pre-linked to its usage
-- log row. Starts in 'pending' status — the wa:send worker flips it
-- to 'sent' after whatsmeow confirms delivery.
INSERT INTO wa_messages (
  tenant_id, instance_id, remote_jid, type, body,
  from_me, status, ai_generated, ai_usage_log_id
)
VALUES ($1, $2, $3, 'text', $4, true, 'pending', true, $5)
RETURNING *;

-- name: CreateOutboundImageMessage :one
-- Operator-attached outbound image (JUR-76). Bytes already in S3 at
-- media_key; the wa:send_image worker downloads + uploads to WhatsApp.
-- Status starts at 'pending'; worker flips to 'sent' on success.
INSERT INTO wa_messages (
  tenant_id, instance_id, remote_jid, type, body,
  media_key, media_mime, media_size_bytes,
  from_me, status
)
VALUES ($1, $2, $3, 'image', $4, $5, $6, $7, true, 'pending')
RETURNING *;

-- name: GetWaMessageByID :one
-- Tenant-scoped fetch by id. Used by the web app's getWaMediaUrl
-- server fn (JUR-77) to validate the requested message belongs to
-- the caller before signing an S3 URL.
SELECT * FROM wa_messages
WHERE id = $1 AND tenant_id = $2
LIMIT 1;

-- name: MarkContactRead :exec
-- Resets unread_count to 0 for a (instance, jid) pair. Called when
-- the user opens the conversation in the UI.
UPDATE wa_contacts
SET unread_count = 0,
    updated_at = now()
WHERE tenant_id = $1
  AND instance_id = $2
  AND remote_jid = $3;
