---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Split deploy: web + api on separate servers (JUR-46).

The api (NestJS + Baileys) runs on a separate VPS from the web app — failure isolation, different resource profiles (web stateless, api stateful with one Baileys socket per tenant), and independent deploy cadence (a web hotfix shouldn't restart all live WhatsApp sockets and force every tenant to rescan QR).

- **`deploy.sh`** is now target-aware: `./deploy.sh web` (legacy default), `./deploy.sh api`. Per-target config via env vars (`WEB_SERVER_IP` / `API_SERVER_IP` / etc.) with sensible defaults for the existing prod web setup. The api path skips the build step entirely (Bun runs `apps/api/src/main.ts` directly) and rsyncs full source for `apps/api`, `packages/db`, `packages/shared`.
- **`ecosystem.config.cjs`** gains a `vintra-api` app entry (Bun interpreter, port 4000, max_memory_restart 900M, single instance — Baileys is stateful). The same file ships to both servers; each starts only its own app via `pm2 start ecosystem.config.cjs --only <name>`.

The api VPS itself isn't provisioned yet — that's tracked in JUR-58. Once the box exists with Bun + PM2 + Redis (JUR-47) installed, `API_SERVER_IP=… ./deploy.sh api` will work end-to-end.

Auth across the two servers is already correct: web's server functions forward the Supabase JWT as `Authorization: Bearer` to the api (`apps/web/src/server/functions/whatsapp.ts:15-34`), and the api's `SupabaseJwtGuard` verifies against the same Supabase project. No CORS, no cookie sharing, no DNS gymnastics required.
