---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Remove the NestJS `apps/api` ahead of the Go rewrite.

The api will be re-implemented in Go + whatsmeow + Fiber + asynq for resource efficiency (~30% RAM reduction at idle), whatsmeow's superior protocol stability vs Baileys, and single-binary deploy ergonomics. See Linear JUR-60 through JUR-69 for the Go-flavored M1+M2 tickets.

Also drops the `api:*` scripts from the root `package.json` and the `vintra-api` entry from `ecosystem.config.cjs` (the Go api will use systemd on its own VPS, not PM2 — see JUR-46).
