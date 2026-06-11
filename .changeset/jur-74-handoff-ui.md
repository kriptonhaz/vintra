---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-74 — handoff workflow UI (web app side):

- Pengaturan AI gains a "Handoff ke Admin" section: admin WhatsApp
  number + N-hour auto-resume window. Admin number is digit-normalized,
  validated 8–15 digits, and required to differ from the instance's
  own paired number (matches the API's self-send guard).
- Chat sidebar pins contacts in handoff to the top with a small
  "Admin" pill so the operator sees them at a glance.
- Conversation header gains a "Butuh admin" pill, and a banner above
  the messages area shows the AI's reason + summary, the countdown
  until auto-resume, and a one-click "Aktifkan kembali AI" button
  that POSTs to the new contact handoff PATCH endpoint.
- New `updateContactHandoff` server function calling
  `PATCH /v1/wa/instances/:id/contacts/:remoteJid/handoff`.

Backend glue:

- `ListWaContacts` query now selects + returns the handoff columns
  (`needs_human`, `handoff_at`, `handoff_reason`, `handoff_summary`)
  and pins handoff contacts to the top via
  `ORDER BY needs_human DESC, last_message_at DESC NULLS LAST, ...`.
- `instanceResp` and `updateInstanceReq` add `adminPhone` +
  `handoffAutoResumeHours`. The `Update` handler validates the hours
  range (0..168) and refuses an admin phone that matches the
  instance's own number (digit-normalized).
