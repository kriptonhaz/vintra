---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add `DbModule` + `RedisModule` to apps/api (JUR-21, M1 of WhatsApp AI Backend).

`DbModule` re-exports the singleton Drizzle client from `@vintra/db` via the `DB_TOKEN` symbol — explicitly avoids opening a second postgres pool against the Supabase pooler. `RedisModule` provides two ioredis clients: `REDIS_DEFAULT` for producers/cache/locks, and `REDIS_BLOCKING` (a `.duplicate()` of the default) reserved for BullMQ workers' blocking commands. Both clients are configured with `maxRetriesPerRequest: null` and `enableReadyCheck: false` (BullMQ's required settings, harmless elsewhere) and quit cleanly on `OnModuleDestroy`.

While wiring this up, `apps/api` switched from `tsc`-emitted JS in production to `tsx src/main.ts` so it can consume `@vintra/db`'s raw-TypeScript exports (`exports: "./src/index.ts"` in `packages/db/package.json`) without restructuring the package. `tsx` is now a regular dependency. Removed `tsconfig.build.json` and `nest-cli.json` since we no longer compile.
