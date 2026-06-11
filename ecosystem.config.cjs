// PM2 ecosystem file for the WEB SERVER ONLY.
//
// The api (Go + whatsmeow) runs on a SEPARATE VPS as a systemd
// service — not a PM2 app. See JUR-46 (deploy split) and JUR-58
// (api VPS provisioning).
//
// Used on the web VPS:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup    # one-time, persist across reboots
//
// Env vars are loaded by Node's built-in --env-file flag from the repo
// root .env (one level up from cwd). Don't put secrets in this file —
// it's committed.
//
// ─── Two-instance setup for zero-downtime deploys ────────────────────
//
// Two SEPARATE PM2 fork apps (vintra-web-a on :3000, -b on :3001)
// fronted by an nginx upstream block. Deploys restart them
// sequentially — when -a is down, nginx routes to -b; when -b is
// down, nginx routes to -a. End result: zero connection drops, no
// Cloudflare 520 during deploys.
//
// We deliberately AVOID PM2 cluster mode (instances: N + exec_mode:
// 'cluster'): the cluster workers crash on startup against
// @hono/node-server (Hono's serve() doesn't get the same
// http.Server.listen() monkey-patch that vanilla http.createServer
// does). The manual 2-fork-app approach sidesteps that entirely.
//
// Memory: 2 × ~135 MB working set = ~270 MB total Node footprint
// (was ~135 MB single instance). The 400 MB cap per instance leaves
// headroom for memory spikes during heavy SSR + a comfortable cache
// reserve on the 914 MB box.
//
// Scheduler (apps/web/src/server/scheduler.ts): gated on
// `process.env.PORT === '3000'` so only -a runs the 1-min cron tick.
// Without that gate both instances would double-fire every tick.
const sharedAppDefaults = {
  cwd: './apps/web',
  script: 'server-entry.mjs',
  interpreter: 'node',
  interpreter_args: '--env-file=../../.env',
  instances: 1,
  exec_mode: 'fork',
  max_memory_restart: '400M',
  time: true,
  autorestart: true,
  watch: false,
  // Grace window for in-flight requests to drain on restart before
  // PM2 escalates to SIGKILL. server-entry.mjs handles SIGINT by
  // closing the HTTP server; 10s is ample for this low-traffic app
  // and prevents deploy-time request severing (Cloudflare 520s).
  kill_timeout: 10000,
}

module.exports = {
  apps: [
    {
      ...sharedAppDefaults,
      name: 'vintra-web-a',
      // 3000 = the scheduler-owning instance (see scheduler.ts gate).
      env: { NODE_ENV: 'production', PORT: 3000 },
    },
    {
      ...sharedAppDefaults,
      name: 'vintra-web-b',
      env: { NODE_ENV: 'production', PORT: 3001 },
    },
  ],
}
