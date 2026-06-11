---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Scaffold `apps/api` — new NestJS service for WhatsApp + AI automation (JUR-19, M1 Foundation of WhatsApp AI Backend project).

Adds a workspace member `@vintra/api` running NestJS 11 on the Fastify adapter, with the dependency surface for the rest of M1/M2 already wired in (`@nestjs/bullmq`, `bullmq`, `ioredis`, `@whiskeysockets/baileys`, `@supabase/supabase-js`, `pino`, `zod`). Standalone CommonJS tsconfig (NestJS doesn't tolerate the bundler-targeted base config). Boots cleanly on `PORT || 4000` with `/v1` global prefix; returns 404 on unmatched routes — verified locally via `bun run api:build && PORT=4099 node apps/api/dist/main.js`.

No production deploy yet — `apps/api` isn't in `ecosystem.config.cjs`. PM2 changes come in JUR-46.
