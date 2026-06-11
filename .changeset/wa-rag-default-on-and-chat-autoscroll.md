---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Two small WA polish items from feedback:

- New WhatsApp instances now land with every basic-tier RAG tool
  pre-enabled (price, stock, recipe availability, store address,
  operating hours, payment methods). Previously the toggles all
  defaulted to off, leaving brand-new tenants with a useful AI tier
  they didn't know they had. The seed runs as part of
  `POST /v1/wa/instances` and uses `ON CONFLICT DO NOTHING` so
  re-creating an instance never clobbers explicit user choices.
  Existing instances are unaffected — they already have rows.
- Chat detail page now scrolls to the most recent message when the
  conversation panel mounts (including the case where the user flips
  to Pengaturan AI and back to Chat — same `selectedJid`, same
  `messages` array, so the previous effect didn't re-fire). Switched
  to `useLayoutEffect` so the scroll lands before paint instead of a
  flash at the top of the thread.
