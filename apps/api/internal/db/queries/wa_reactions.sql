-- name: UpsertWaReaction :exec
-- JUR-80: store an inbound emoji reaction. Unique on
-- (parent_message_id, sender_jid) so the same sender swapping their
-- reaction (👍 → ❤️) overwrites in place rather than stacking.
INSERT INTO wa_reactions (
  tenant_id, instance_id, parent_message_id, sender_jid, emoji
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (parent_message_id, sender_jid)
DO UPDATE SET
  emoji = EXCLUDED.emoji,
  updated_at = now();

-- name: DeleteWaReaction :exec
-- Reaction-removed event (whatsmeow delivers an empty Text). Drops
-- the row so the bubble's pill disappears. No audit history kept —
-- per the JUR-80 design we don't need it for v2.
DELETE FROM wa_reactions
WHERE parent_message_id = $1 AND sender_jid = $2;

-- name: FindWaMessageByExternalID :one
-- Inbound reaction lookup: whatsmeow's ReactionMessage points at the
-- parent by external ID, but our schema's PK is the internal UUID.
-- Tenant + instance scoping is mandatory so a leaked external ID
-- across tenants can't accidentally cross-link.
SELECT id FROM wa_messages
WHERE tenant_id = $1 AND instance_id = $2 AND external_id = $3
LIMIT 1;

-- name: ListReactionsForMessages :many
-- Fan-out: given a slice of message IDs (the conversation tail the
-- UI just rendered), return all their reactions in one round trip.
-- The web layer pivots them by parent_message_id into the Message
-- shape it sends back to the browser.
SELECT id, parent_message_id, sender_jid, emoji, created_at
FROM wa_reactions
WHERE parent_message_id = ANY($1::uuid[])
ORDER BY created_at ASC;
