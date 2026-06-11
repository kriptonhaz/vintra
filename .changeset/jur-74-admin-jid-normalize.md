---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix admin handoff WhatsApp notification never delivering. The
`admin_phone` column was storing user input verbatim
("08118492869") and the worker was concatenating it as
"08118492869@s.whatsapp.net" — not a valid WhatsApp JID. whatsmeow
ran USync to discover the (non-existent) user, timed out at 30s,
retried 2 more times, and dropped the notification.

Two fixes:

- `wa_instances.Update` now runs admin_phone through
  `whatsapp.NormalizeJID` before saving, so "08..." gets canonicalised
  to E.164-without-plus ("628..."). Stored as digit-only for parity
  with the rest of the column.
- `dispatchAdminNotification` defensively normalises again at send
  time so older rows (or any row that bypassed the API) still
  produce a valid JID. Logs and skips with a clear error if the
  number is unparseable instead of enqueueing a doomed send.
