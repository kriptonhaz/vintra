---
"@vintra/web": patch
---

ops: switch web PM2 to cluster mode (2 instances) for zero-downtime
deploys.

Single-fork-mode + `pm2 restart` was leaving a ~1-second window
where Cloudflare couldn't reach the origin → 520 errors at the
edge for any visitor caught in that window. Now:

- `ecosystem.config.cjs`: `instances: 2, exec_mode: 'cluster'`.
  Per-instance `max_memory_restart: '300M'` (was 500M) keeps the
  total cap at 600 MB, well under the 914 MB Lightsail capacity
  even with cache + nginx + api.
- `deploy.sh`: swap `pm2 restart` → `pm2 reload --update-env`
  (rolling — replaces one worker at a time while the other keeps
  serving). Auto-detects when ecosystem mode has drifted from the
  running mode (e.g. the fork→cluster cutover) and does
  `pm2 delete + pm2 start` so the script handles the one-time
  transition cleanly.
- `apps/web/src/server/scheduler.ts`: gate cron startup on
  `NODE_APP_INSTANCE === '0'`. Without this, both workers would
  fire the 1-minute cron tick and we'd rely on idempotency keys
  to dedupe — works but wastes DB queries and floods logs.

Memory cost: ~+70 MB total. Still ~290 MB headroom on the box.
