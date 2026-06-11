---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add Postgres + Redis clients + sqlc config to `apps/api` (JUR-61, M1 Foundation).

- **`internal/db/db.go`** — pgxpool wrapper with `DefaultQueryExecMode = pgx.QueryExecModeExec` (the workaround for Supabase's transaction-mode pooler not supporting PostgreSQL prepared statements; same constraint as `prepare: false` in apps/web's postgres-js setup). Pool sized 2–10 conns with a 5min idle timeout, plus a 5s boot-time ping so bad `DATABASE_URL` surfaces at startup rather than under traffic.
- **`internal/redis/redis.go`** — go-redis v9 wrapper that parses `REDIS_URL`, pings with a 3s budget, and exposes `Ping(ctx)` for the future `/readyz` (JUR-41). Comment explicitly notes whatsmeow's session store is SQLite — Redis is only for asynq, locks, dedupe, and rate buckets.
- **`sqlc.yaml`** — points schema at `packages/db/src/migrations` (the Drizzle-generated SQL) and queries at `internal/db/queries/`. `emit_prepared_queries: false` so the generated code aligns with the pooler constraint; `emit_interface: true` for easier mocking in tests. Queries are added feature-by-feature starting with JUR-63.
- **`cmd/api/main.go`** — opens both clients after `config.Parse()`, ping fails are boot-fatal. Both are `Close()`d on graceful shutdown via deferred cleanup.

Smoke-tested against the real Supabase pooler + local Redis: both connect, `/v1/ping` returns 200 JSON.
