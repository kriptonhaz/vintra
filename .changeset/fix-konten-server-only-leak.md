---
"@vintra/web": patch
---

Fix the web client build — the `postgres` driver was leaking into the browser bundle. Adding plain function exports (`getDefaultImageProvider`, `resolvePricing`) to `konten.ts` defeated TanStack Start's client-side stripping of its `db` import, and the Logo flow imported through it. Both helpers now live in a dedicated server-only file (`apps/web/src/server/lib/ai-image-provider.ts`) so the server-function files remain pure `createServerFn` + types and the vite plugin can strip them cleanly.
