---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-46 — split deploy script + ship the api ops artifacts.

`./deploy.sh api` now does what it says (it previously ran the
old NestJS+Bun flow which never matched the Go rewrite):

- Cross-compiles a static linux/amd64 Go binary locally with
  `CGO_ENABLED=0 -trimpath -ldflags "-s -w -X main.appVersion=$SHA"`.
- rsyncs to `/home/ubuntu/prod/vintra-api/bin/api.new`.
- Atomic swap + `sudo systemctl restart vintra-api` (NOPASSWD rule
  for the unit, set in JUR-58 setup).
- Polls `/healthz` via ssh to fail the deploy on a crash-on-startup.

Defaults assume the api shares the web VPS (`API_SERVER_IP` falls back
to `WEB_SERVER_IP`); override when you split hosts later.

New repo artifacts:

- `deploy/api/vintra-api.service` — systemd unit with
  `ProtectSystem=strict`, memory caps (MemoryMax=900M /
  MemoryHigh=700M), graceful SIGTERM (20s).
- `deploy/nginx/api.vintra.my.id.conf` — nginx vhost for
  `api.vintra.my.id` proxying to `127.0.0.1:4000`. Includes
  gzip, WebSocket upgrade headers (for future SSE), 60s timeouts.
- `deploy/api/README.md` — one-time VPS setup checklist (Redis
  config, .env layout, certbot, sudoers NOPASSWD rule, first deploy).

`ecosystem.config.cjs` was already clean (only `vintra-web`),
no changes there.
