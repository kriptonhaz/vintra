---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

`wa_instances` CRUD endpoints + first sqlc usage (JUR-63, M2).

- **`internal/db/queries/wa_instances.sql`** — 7 named queries: Create, ListByTenant, Get, partial Update (COALESCE + sqlc.narg pattern so callers patch only the fields they care about), Delete, plus two helpers that JUR-65/JUR-66 will consume (UpdateWaInstanceStatus, ListWaInstancesForRevival).
- **`internal/db/queries/generated/`** — sqlc-generated Querier interface + WaInstance struct + handler functions. ~1050 LOC committed (deterministic from schema + queries, but checked in so downstream consumers don't need sqlc locally; regenerate with `sqlc generate` from `apps/api/`).
- **`internal/db/uuid.go`** — tiny `ParseUUID`/`UUIDString` helpers bridging pgtype.UUID ↔ canonical hyphenated string form at HTTP boundaries.
- **`internal/http/handlers/wa_instances.go`** — 5 Fiber handlers + request/response DTOs. Response DTO flattens pgtype.X into plain JSON (the generated struct would otherwise serialize as ugly `{bytes,valid}` nested objects). Hard tenant scoping on every query; cross-tenant access returns 404 (not 403) per the canceled ticket's "don't leak which is which" guidance. Inline validation: label 1–100 chars, aiProvider must be openai|gemini, aiMaxHistory 1–50, PATCH requires ≥1 field.
- **`internal/http/server.go`** — Deps now includes `*queries.Queries`; routes registered per-method with explicit auth+tenant middleware.

Smoke verified:
- `POST /v1/wa/instances` no auth → 401
- `GET /v1/wa/instances` no auth → 401
- `PATCH /v1/wa/instances/abc` bogus token → 401 (auth runs before path validation)
- `/v1/wa/unknown` (no route) → 404 (per-route middleware doesn't catch unmatched paths)

`go vet` clean, 16 tests pass across 10 packages.
