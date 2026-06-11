---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

DELETE /v1/wa/instances/:id now eagerly cleans up everything the
instance touched, not just the Postgres rows:

- DB cascade (unchanged): wa_messages, wa_contacts deleted via the
  existing FK onDelete: cascade.
- New: `registry.Purge` closes the in-memory whatsmeow socket AND
  removes the per-instance SQLite session file (`data/{id}.db` +
  -wal/-shm sidecars). Previously the socket leaked until restart
  and the SQLite file accumulated forever.
- New: `storage.Client.DeletePrefix` lists + batch-deletes every S3
  object under `{tenantId}/wa/{instanceId}/`. Saves us up to 3 days
  of waiting for the kind=wa-media lifecycle rule to catch up.

All three cleanup steps are best-effort with structured logging —
DB delete is the source of truth; if registry/S3 cleanup fails, the
api restart + S3 lifecycle eventually self-heal.
