---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add validated env config to `apps/api` (JUR-20, M1 of WhatsApp AI Backend).

Zod schema in `apps/api/src/config/env.schema.ts` covers `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REDIS_URL`, `OPENAI_API_KEY` (optional), `GEMINI_API_KEY` (optional), plus runtime knobs (`PORT`, `NODE_ENV`, `LOG_LEVEL`, `APP_URL`). Parsed once in `main.ts` before `NestFactory.create` — boot exits with a readable per-key error list if anything required is missing, so configuration mistakes never reach the DI container.

`ConfigService` exposes typed access (`.get('REDIS_URL')` returns `string`, never `string | undefined`) via a `@Global()` `ConfigModule`. `dotenv/config` is imported at the top of `main.ts` so `apps/api/.env` is loaded for both `tsx watch` and `node dist/main.js`.
