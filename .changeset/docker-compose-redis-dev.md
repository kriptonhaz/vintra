---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add `docker-compose.yml` at repo root with a Redis 7 service for local dev (JUR-24, M1 of WhatsApp AI Backend).

Postgres deliberately excluded — we use the existing Supabase project to avoid dev/prod schema drift and to save RAM on the 4 GB dev box. Redis runs with `appendonly yes` (so Baileys creds survive restarts) and `noeviction` policy so we never silently lose session data under memory pressure.
