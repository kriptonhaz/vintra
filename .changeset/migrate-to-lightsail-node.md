---
"@vintra/web": minor
---

Migrate deployment from Netlify Functions to a self-managed Node server
on AWS Lightsail (Singapore region):

- Drop `@netlify/vite-plugin-tanstack-start`. `vite.config.ts` now
  builds with `tanstackStart({ target: 'node-server' })`.
- Delete `apps/web/netlify.toml`.
- Add a thin Node HTTP entry at `apps/web/server-entry.mjs` that wraps
  the SSR Web-Fetch handler from `dist/server/server.js` via
  `@hono/node-server` (new dep). Listens on `process.env.PORT || 3000`,
  binds `0.0.0.0` so nginx can reach it.
- Add `start` script in `apps/web/package.json`:
  `node server-entry.mjs`.
- New PM2 ecosystem file at repo root (`ecosystem.config.cjs`) — single
  fork instance, 500 MB restart threshold, autorestart on crash.
- New `deploy.sh` at repo root: builds locally (the VPS doesn't have
  enough RAM to build), rsyncs `apps/web/dist/` + workspace package
  metadata to the server, runs `bun install --production`, and
  PM2-restarts. SSH key path + IP are env-var overridable.
- `.gitignore` now excludes `*.pem`, `*.key`, and the
  `vintra-prod.txt` connection note so SSH credentials never get
  committed.

Cutover notes (server-side, not in this PR):
- nginx reverse proxy → `127.0.0.1:3000`, serves `apps/web/dist/client/`
  static assets directly
- SSL via certbot
- Env vars copied from Netlify dashboard into `apps/web/.env` on the VPS
- DNS A record swap when ready to cut over
