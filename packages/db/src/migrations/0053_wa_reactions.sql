-- JUR-80: capture inbound emoji reactions attached to a parent message.
-- v1 silently dropped them in registry.isSkippableMessage; v2 surfaces
-- them on the bubble so operators can see the customer's signal.

CREATE TABLE IF NOT EXISTS wa_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES wa_instances(id) ON DELETE CASCADE,
  parent_message_id uuid NOT NULL REFERENCES wa_messages(id) ON DELETE CASCADE,
  sender_jid text NOT NULL,
  emoji text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wa_reactions_parent_sender_uniq
  ON wa_reactions(parent_message_id, sender_jid);

CREATE INDEX IF NOT EXISTS wa_reactions_parent_idx
  ON wa_reactions(parent_message_id);
