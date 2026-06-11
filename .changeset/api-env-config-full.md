---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Full env contract for `apps/api` (JUR-69, M1 Foundation).

`internal/config/config.go` now declares `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REDIS_URL` as required (boot exits with a readable per-key error list if any is missing). `OPENAI_API_KEY` + `GEMINI_API_KEY` remain optional — the AI adapters in JUR-33–35 will validate them at first call so a tenant who only uses one provider isn't blocked.

Added `IsProduction()` helper for the slog handler picker and any other "behave differently in prod" branches. Five unit tests in `config_test.go` cover the defaults path, each missing-required failure, the production flag, and the empty-optional path; all use `os.Unsetenv` (not `t.Setenv(k, "")`) because caarlos0/env's `required` is a presence check — setting to empty string would falsely pass.

Updated `apps/api/.env.example` with documented sections for runtime, Postgres (Supabase pooler note about `prepare: false`), Supabase Auth (server-only key warning), Redis (clarifies whatsmeow uses SQLite, Redis is for asynq + locks + dedupe only), and AI providers.
