---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Scaffold `apps/api` as a Go service (JUR-60, M1 Foundation).

Fresh Go workspace replacing the previously-removed NestJS api. Boots a Fiber HTTP server on `:4000` with `/v1` prefix, structured `slog` output, panic recovery, JSON 404 fallback, and graceful shutdown on SIGINT/SIGTERM. No external dependencies required to run — config defaults make `make dev` work on a fresh laptop.

Layout:
```
apps/api/
├── go.mod                  // github.com/kriptonhaz/vintra/apps/api
├── Makefile                // make dev / build / run / tidy / test / vet / clean
├── .air.toml               // hot reload config
├── .env.example            // documented env contract (most vars added in JUR-61/62/33)
├── .gitignore              // tmp/, bin/, data/, *.db, .env
├── cmd/api/main.go         // bootstrap: dotenv → config → slog → fiber → listen → graceful shutdown
└── internal/
    ├── config/config.go    // caarlos0/env-backed Config with safe defaults
    └── http/server.go      // Fiber app builder, /v1/ping smoke route, JSON 404
```

Locally verified: `go vet ./...` clean, `go build ./...` clean, `make run` listens on `:4000`, `curl /v1/ping` returns `{"ok":true,...}`, unknown paths return JSON 404 with the requested path echoed.

Subsequent Go tickets layer on top: JUR-69 (full env contract), JUR-61 (pgx + sqlc + go-redis), JUR-62 (Supabase JWT middleware + tenant context), JUR-63→68 (M2 WhatsApp), JUR-33→39 (M3 AI).
