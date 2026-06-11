---
"@vintra/web": patch
---

ops: zero-downtime deploys via 2 PM2 fork apps + nginx upstream.

Replaces the failed PM2 cluster-mode attempt (which crashed on
startup against @hono/node-server) with a manual 2-fork-app setup
fronted by an nginx upstream block. nginx round-robins between the
instances and `proxy_next_upstream` silently retries if one is
mid-restart.

- `ecosystem.config.cjs`: defines `vintra-web-a` on :3000 and
  `vintra-web-b` on :3001. Both are plain fork-mode (no cluster).
  Per-instance `max_memory_restart: '400M'` — 800 MB total cap on
  the 914 MB Lightsail box, still leaves headroom.
- `apps/web/src/server/scheduler.ts`: gated on
  `process.env.PORT === '3000'` so only -a runs the 1-min cron tick.
  Without this both apps would double-fire every minute.
- `deploy/nginx/vintra.conf`: new `upstream vintra_backend`
  block at the top (shared across all vhosts in the http context).
  Apex location swaps `proxy_pass http://127.0.0.1:3000` for
  `proxy_pass http://vintra_backend` and adds
  `proxy_next_upstream error timeout http_502 http_503 http_504
  non_idempotent` with `tries 2`. Also enables keepalive 16 on
  upstream connections (~10ms saved per request).
- `deploy/nginx/public-tenant.conf`: same proxy_pass swap +
  proxy_next_upstream (upstream block is shared).
- `deploy.sh`: `remote_install_and_restart` rewritten as a rolling
  restart — kicks `-a`, polls :3000 until 200, then kicks `-b`,
  polls :3001 until 200. Handles three states: both apps exist
  (steady), only legacy `vintra-web` exists (cutover), or
  nothing exists (first deploy).

**Cutover steps (not automated; do manually with SSH):**
1. `scp` the two updated nginx vhost files → `sites-available/`
2. `sudo nginx -t && sudo systemctl reload nginx`
   (safe: nginx routes all traffic to :3000 because :3001 has
   nothing on it yet; max_fails=2 marks :3001 down silently)
3. SSH and run `./deploy.sh web` — the script's first-time branch
   will `pm2 delete vintra-web` (the legacy single app) and
   `pm2 start ecosystem.config.cjs` which brings both -a and -b
   online. Few seconds of downtime once during this cutover.
4. Confirm both ports respond (`curl :3000/ && curl :3001/`)
5. Trigger another `./deploy.sh web` to confirm rolling restart
   works without dropping requests.
