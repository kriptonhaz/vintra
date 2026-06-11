---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-93: resolve LID-only inbound to PN form using whatsmeow's local
mapping cache, then backfill old `wa_contacts` and `wa_messages` rows
so master-customer JOINs (and the chat header / sidebar) start showing
the saved name + phone instead of the raw `152673…@lid`.

- `registry.inboundSubscriber` now consults
  `conn.Client.Store.LIDs.GetPNForLID()` when the current event carries
  only a LID. whatsmeow auto-populates that cache whenever any prior
  inbound arrived with `SenderAlt`/`RecipientAlt`, so subsequent
  messages from the same privacy-on customer resolve to the PN on
  arrival — no re-pair required.
- When the cache resolves a previously-unknown PN, the subscriber
  enqueues a `wa:lid_backfill` asynq task BEFORE the `wa:incoming` task.
- New `WALidBackfillHandler` opens a single transaction:
  `RenameWaContactJid` (UPDATE wa_contacts SET remote_jid = pn,
  lid_jid = COALESCE(lid_jid, old_lid)) → `RenameWaMessagesJid`
  (UPDATE wa_messages SET remote_jid = pn). Idempotent — re-runs on
  already-renamed data return 0 rows and exit clean.
- Unique-violation (SQLSTATE 23505) means a PN-form contact already
  exists for the same person (rare: identity messaged from two devices,
  one disclosed PN, one didn't). v1 logs warn + no-ops; the merge path
  is a deferred follow-up. No data lost — both rows persist as-is.

Originally planned around `evt.LIDMapping`, but whatsmeow doesn't
expose that as a public event — it's purely an internal Store update
inside `handleEncryptedMessage`. Opportunistic lookup is the right
shape given the actual library surface.
