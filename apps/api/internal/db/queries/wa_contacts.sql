-- name: ListWaContacts :many
-- Lists contacts for a (tenant, instance), newest-message-first, with
-- the last message body + direction joined so the chat UI can render
-- a WhatsApp-style preview without N+1 round-trips.
--
-- The LATERAL join picks the single newest wa_messages row per
-- contact. NULL last_body / last_from_me means the contact exists but
-- has no messages (rare — happens if the contact was upserted before
-- the message insert in some future race; harmless either way).
SELECT
  c.id,
  c.instance_id,
  c.remote_jid,
  c.lid_jid,
  c.name,
  c.push_name,
  c.last_message_at,
  c.unread_count,
  c.needs_human,
  c.handoff_at,
  c.handoff_reason,
  c.handoff_summary,
  m.body       AS last_body,
  m.from_me    AS last_from_me,
  m.type       AS last_type,
  m.created_at AS last_created_at,
  -- Master customer data joined by normalised phone (JUR follow-up).
  -- customers.phone is already canonical "628..." (see normalizePhone
  -- + migration 0022); the JID's user part is the same digits, so a
  -- straight equality match works. LID JIDs never match by design
  -- (no phone, no customer linkage possible).
  cust.id          AS master_customer_id,
  cust.name        AS master_customer_name
FROM wa_contacts c
LEFT JOIN LATERAL (
  SELECT body, from_me, type, created_at
  FROM wa_messages
  WHERE instance_id = c.instance_id
    AND (remote_jid = c.remote_jid OR (c.lid_jid IS NOT NULL AND remote_jid = c.lid_jid))
  ORDER BY created_at DESC
  LIMIT 1
) m ON true
LEFT JOIN customers cust ON cust.tenant_id = c.tenant_id
  AND cust.phone = split_part(c.remote_jid, '@', 1)
WHERE c.tenant_id = $1 AND c.instance_id = $2
ORDER BY c.needs_human DESC, c.last_message_at DESC NULLS LAST, c.created_at DESC;

-- name: GetWaContactByJid :one
-- Single contact lookup, used by ai:reply worker to check the handoff
-- state before generating a response.
SELECT * FROM wa_contacts
WHERE instance_id = $1 AND remote_jid = $2
LIMIT 1;

-- name: SetWaContactHandoff :execrows
-- Flips the handoff flag on. Idempotent at the DB level — the worker
-- additionally checks `needs_human` was previously false before
-- enqueueing notifications, so concurrent triggers don't double-fire.
UPDATE wa_contacts
SET needs_human = true,
    handoff_at = now(),
    handoff_reason = $3,
    handoff_summary = $4,
    updated_at = now()
WHERE instance_id = $1 AND remote_jid = $2;

-- name: ClearWaContactHandoff :execrows
-- Clears the handoff flag. Called by the manual "Aktifkan kembali AI"
-- button AND by the ai:reply worker on N-hour auto-resume.
UPDATE wa_contacts
SET needs_human = false,
    handoff_at = NULL,
    handoff_reason = NULL,
    handoff_summary = NULL,
    updated_at = now()
WHERE instance_id = $1 AND remote_jid = $2;

-- name: UpsertWaContactNoPushName :exec
-- Used by the outbound send path. The sender doesn't know the
-- recipient's push_name, so we only stamp last_message_at + create the
-- row if missing. ON CONFLICT preserves any existing push_name set by
-- a previous inbound message.
INSERT INTO wa_contacts (tenant_id, instance_id, remote_jid, last_message_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (instance_id, remote_jid)
DO UPDATE SET
  last_message_at = EXCLUDED.last_message_at,
  updated_at = now();

-- name: RenameWaContactJid :execrows
-- JUR-93: rename a LID-form wa_contacts row to its newly-discovered
-- PN form. Returns the number of rows updated so the caller can tell
-- whether the contact existed (1) or was already migrated (0).
UPDATE wa_contacts
SET remote_jid = $3,
    lid_jid = COALESCE(lid_jid, $2),
    updated_at = now()
WHERE instance_id = $1 AND remote_jid = $2;

-- name: RenameWaMessagesJid :execrows
-- JUR-93: paired with RenameWaContactJid — bulk-rewrite the remote_jid
-- on every wa_messages row that pointed at the old LID. Returns the
-- count so the caller can log it.
UPDATE wa_messages
SET remote_jid = $3
WHERE instance_id = $1 AND remote_jid = $2;
