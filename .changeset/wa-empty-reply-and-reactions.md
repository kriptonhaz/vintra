---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Two bug fixes surfaced testing the v1 media flow:

- AI's empty completion no longer produces a blank WhatsApp bubble.
  DeepSeek occasionally returns "" when the conversation context is
  ambiguous (e.g., the customer declines a handoff suggestion right
  after the contact comes out of handoff). Previously we'd persist +
  send the empty body, which produced a content-less green bubble at
  the customer's end. Now we log a warn and skip the persist; the
  operator can follow up manually if it matters.
- Inbound reactions / protocol messages (edits / revokes / disappearing-
  mode toggles) no longer appear as "[Pesan tidak didukung]" bubbles
  in the chat. New `isSkippableMessage` filter drops them in the
  provider before dedupe + enqueue. Reactions aren't modelled yet —
  v2 work to attach them to the parent message.
