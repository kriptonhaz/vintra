---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add Supabase JWT guard + TenantContext interceptor to apps/api (JUR-22, M1 of WhatsApp AI Backend — closes M1).

`SupabaseJwtGuard` extracts the access token from `Authorization: Bearer` or the `sb-access-token` cookie, calls `auth.getUser()` against the same Supabase project that apps/web logs the user into, and attaches the verified `userId` to the request. `TenantContextInterceptor` then resolves the user's `tenant_members` row (mirroring the SQL pattern from `apps/web/src/server/middleware/auth.ts:256-264`) and attaches `{ userId, tenantId, role }` as `req.tenantCtx`. Controllers consume it via the `@TenantCtx()` param decorator. Both apply globally via `APP_GUARD` + `APP_INTERCEPTOR`. `@Public()` opts a route out of both — reserved for `/healthz`, `/readyz` later.

Smoke-tested via a placeholder `GET /v1/me` controller: no token → 401, bogus token → 401, both with the expected JSON error body.

While wiring this, switched the api runtime from `tsx` to `bun --watch src/main.ts` (dev) / `bun src/main.ts` (prod). `tsx`'s underlying esbuild does not emit full decorator metadata, which broke `Reflector` injection on the global guard. Bun has native support for `experimentalDecorators` + `emitDecoratorMetadata` and is already required on the prod box per `deploy.sh`, so this is a net simplification — `tsx` dropped from runtime dependencies.
