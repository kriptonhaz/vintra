---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Instance registry + lifecycle endpoints (JUR-66, M2).

- **`internal/whatsapp/registry.go`** — `Registry` owns `map[instanceID]*instanceRecord` (Connection + Store) under `sync.RWMutex`. `Start(ctx, id)` is idempotent with a fast path + double-checked locking pattern: races between two callers don't leak a duplicate socket (loser disconnects + closes). `Stop` tears down both. `Get` returns `ErrInstanceNotConnected` for the send path. One SQLite file per instance under `data/{instanceID}.db` — simpler than multi-device-per-store. The registry also subscribes a `statusSubscriber` to every Connection it creates that maps event types back to `wa_instances.status` writes (fire-and-forget background ctx with 5s timeout — never block the whatsmeow hot path on Supabase round-trips).
- **`Revive(ctx)`** — called once at boot. Queries `wa_instances` for rows in `'connected'` or `'connecting'` and calls `Start` for each. Failures log and continue (partial revive > refusing to boot).
- **`Shutdown(ctx)`** — drains all connections + closes stores. Blocks on a `done` channel with `ctx` as the timeout. Called from `main.go` AFTER Fiber's HTTP shutdown so in-flight `/connect` waiters can still talk to the socket while it's being torn down.
- **`internal/http/handlers/wa_lifecycle.go`** — 3 endpoints:
  - `POST /v1/wa/instances/:id/connect`: tenant-scoped ownership check, `registry.Start`, subscribes for ≤30s waiting for QR/Connected/LoggedOut/GiveUp. Returns `{status: connected}` fast-path if already up. Falls back to `{status: connecting}` on timeout so clients can poll `/status`.
  - `POST /v1/wa/instances/:id/disconnect`: tears down via `registry.Stop`, returns 204.
  - `GET /v1/wa/instances/:id/status`: live `Registry.Status` if known, else falls back to the `wa_instances` row. Always sends `lastDisconnectReason` (nullable).
- **`internal/http/server.go`** — Deps gains `*whatsapp.Registry`; 3 new routes registered.
- **`cmd/api/main.go`** — Constructs registry, fires `Revive` in a goroutine (don't block listener boot on a slow Supabase query), shuts down HTTP THEN registry on SIGTERM (order matters).

Smoke verified: all 3 new endpoints 401 without auth, boot log shows the `registry revive: no instances to attach` line.

Real-phone pairing flow remains gated on JUR-32.
