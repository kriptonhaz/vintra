---
"@vintra/web": patch
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-80 (backend half): capture inbound WhatsApp reactions instead of
dropping them. v1's `isSkippableMessage` swallowed reactions to keep
"[Pesan tidak didukung]" bubbles out of the inbox; v2 stores them in
a new `wa_reactions` table so the operator gets visibility on the
👍 / ❤️ signal customers send (yes-on-product-photo, thanks-on-receipt).

- New table `wa_reactions` with unique `(parent_message_id, sender_jid)`
  so the same sender swapping their reaction overwrites in place;
  removing the reaction (whatsmeow delivers empty `Text`) deletes the
  row. No audit history kept for v2.
- Provider (`registry.go`) now detects `ReactionMessage` BEFORE
  `isSkippableMessage` and enqueues a dedicated `wa:reaction` task
  carrying the parent's external ID + emoji + sender JID. Returns
  early so the rest of the inbound pipeline (dedupe / media download /
  `wa:incoming`) doesn't see reaction events.
- New `WAReactionHandler` worker resolves parent message UUID by
  external ID (tenant + instance scoped to prevent cross-tenant
  cross-link), then upserts or deletes. Orphan reactions (parent
  deleted/expired) log warn + ack-success — no point retrying.
- `wa:reaction` queue added to asynq config (concurrency 1; reactions
  are tiny, single-row upserts).

UI rendering of the reaction pill on bubbles is the second half — see
the JUR-80 frontend changeset (separate commit). Until that ships, the
table fills up but the inbox UI stays unchanged. This split lets us
verify the data flow in prod before committing UI cycles.

Outbound reactions (operator long-press → emoji picker) remain
out of scope per the JUR-80 ticket.
