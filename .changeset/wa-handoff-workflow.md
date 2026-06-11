---
"@vintra/web": patch
"@vintra/db": minor
"@vintra/shared": patch
---

Backend foundation for the WhatsApp AI human-handoff workflow (JUR-74 v1).

When the AI decides it can't help and tells the customer "alihkan ke
admin", it now actually does:

- **Pre-reply check** — `wa_contacts.needs_human=true` skips AI auto-reply
  for that contact. Auto-resumes after `wa_instances.handoff_auto_resume_hours`
  if the customer sends a new message past the timeout (default 24h).
- **Post-reply detection** — heuristic substring match on the AI's
  reply for handoff phrases (`alihkan ke admin`, `hubungkan ke admin`,
  etc.). When matched, marks the contact and dispatches admin notification.
- **Admin WhatsApp notification** — enqueues a `wa:send` task from the
  same instance to the configured `admin_phone`. Self-send guard
  prevents accidentally messaging the instance's own number.
- **Manual resume endpoint** — `PATCH /v1/wa/instances/:id/contacts/:jid/handoff`
  with `{enabled}` to toggle. Also supports manual pause for admins to
  pre-empt AI on sensitive chats.
- **Group chats** (`@g.us`) skip handoff entirely.

Two columns added to `wa_instances`: `admin_phone`, `handoff_auto_resume_hours`.
Four columns added to `wa_contacts`: `needs_human`, `handoff_at`,
`handoff_reason`, `handoff_summary`. Partial index on
`(instance_id, needs_human) WHERE needs_human` for fast badge lookups.

**Deferred to JUR-74-followup tickets** (intentionally out of scope here):
- Structured JSON output from the LLM (Option B). v1 uses heuristic
  detection because the system prompt already enforces consistent
  handoff phrasing. Switch when production data shows misses.
- In-app notification + web push channels. v1 ships only the WhatsApp
  channel, which is the highest-signal one for merchants.
- Admin UI: Pengaturan AI form section + chat banner + sidebar badge.
  Backend supports it; the React surfaces land in the followup ticket.
