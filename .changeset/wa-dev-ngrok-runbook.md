---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add `docs/wa-dev.md` — runbook for the ngrok-based local dev flow against the WA api (JUR-59).

Covers prerequisites (Bun, Docker, ngrok), the local stack (`docker compose up -d redis` + `bun --watch src/main.ts`), the tunnel setup, the two ways to wire web at the tunnel (local web dev vs. prod web temporarily), explicit safety rules for the prod-pointing path (don't leave it on, don't share the URL, local Redis sessions don't transfer), an end-to-end auth-flow recap, and a troubleshooting table for the common boot/connect failures we've already seen in this codebase.

Also annotates `apps/web/.env.example` with the three valid `API_URL` values (local / ngrok / prod) and a pointer to the new doc.
