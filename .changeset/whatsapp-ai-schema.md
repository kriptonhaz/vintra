---
"@vintra/web": patch
"@vintra/db": minor
"@vintra/shared": patch
---

Add WhatsApp + AI tables to `@vintra/db` (JUR-23, M1 of WhatsApp AI Backend).

New schema files `packages/db/src/schema/whatsapp.ts` (`wa_instances`, `wa_messages`, `wa_contacts`) and `packages/db/src/schema/ai.ts` (`ai_usage_logs`). All four tables carry a `tenant_id` FK to `tenants(id) ON DELETE CASCADE`; `wa_messages` and `wa_contacts` also FK on `wa_instances(id) ON DELETE CASCADE`. Money is `numeric(12,6)` (never float). Indexes optimized for the conversation-tail hot read (`wa_messages` (instance_id, remote_jid, created_at)), dedupe by Baileys `external_id`, and the monthly-cost rollup (`ai_usage_logs` (tenant_id, created_at)).

Migration `0036_whatsapp_ai.sql` was hand-written rather than via `drizzle-kit generate` because the existing `meta/0004_snapshot.json` and `meta/0005_snapshot.json` are byte-identical with the same `id`/`prevId`, which makes drizzle-kit fail with a "snapshot collision" error before producing any output. The runtime migrator (`drizzle-orm/postgres-js/migrator`) only reads `_journal.json` + SQL files, so this works fine — we just lose snapshot regeneration until the historical dupe is cleaned up in a separate change.
