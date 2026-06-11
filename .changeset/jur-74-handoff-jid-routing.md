---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix the per-contact "Jeda AI" / "Aktifkan AI" toggle silently no-opping
on Mantra Maker — the button label never flipped because the API
returned 200 but didn't actually update any row.

Root cause: the handoff endpoint had the JID in a path param
(`/contacts/:remoteJid/handoff`). Fiber treats `.` as a route
delimiter and silently truncated the suffix of JIDs like
`6285119786395@s.whatsapp.net`, so the `WHERE remote_jid = ?`
filter matched zero contacts. The query is `:exec` so no error
surfaced.

Fixes:

- Move JID into the request body, mirroring `/contacts/read` (the
  same pattern that already works for mark-read).
- Convert the two handoff queries to `:execrows` and 404 when zero
  rows update — silent no-ops are how this bug hid for a release.
- Add an optimistic update on the React side so the button label
  flips instantly instead of waiting for the next 5s contact-list
  refetch. Rolled back on error.
