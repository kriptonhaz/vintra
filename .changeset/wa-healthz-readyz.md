---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add `/healthz` and `/readyz` ops endpoints to the api.

- `GET /healthz` — cheap liveness check. Returns `{ok, uptime, version,
  go}` without touching any downstream. For process supervisors
  (systemd, PM2) deciding whether to restart the process.
- `GET /readyz` — readiness check. Pings Postgres + Redis (each with a
  1-second per-dep timeout), reports per-dep status, and includes
  `activeInstances` count from the whatsmeow registry. Returns 503 with
  the same JSON when any dep fails so load balancers can drop the
  instance from rotation.

Both are unauthenticated and live at the root (no `/v1` prefix) so
monitoring URLs stay short and version-stable.

`appVersion` is overridable at build time via `-ldflags`. Closes JUR-41.
