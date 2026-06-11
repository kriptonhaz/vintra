---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Supabase JWT middleware + tenant context resolution + `/v1/me` smoke endpoint (JUR-62, closes M1 Foundation).

- **`internal/auth/verifier.go`** — Plain `net/http` GET to `/auth/v1/user` with the JWT as `Authorization: Bearer` and the secret key as `apikey`. No supabase-go SDK (avoids ~200 KB of dependency churn for what's a 40-line contract). Returns `ErrInvalidToken` for any 4xx; wraps 5xx separately so middleware can return 502 instead of misclassifying Supabase downtime as a bad token. 5 unit tests cover success, 401/403/422, 5xx, and trailing-slash base URL handling — all via `httptest.NewServer`.
- **`internal/tenant/tenant.go`** — `Service.Get(ctx, userID)` runs the same SQL pattern as `apps/web/src/server/middleware/auth.ts:256-264` (single tenant_members lookup) and returns a `Ctx` struct. `ErrNoMembership` is the sentinel that middleware maps to 403.
- **`internal/http/middleware/middleware.go`** — Two Fiber handlers: `Auth(*Verifier)` extracts the JWT from Authorization header OR `sb-access-token` cookie, verifies, and stores `userID` in `c.Locals` via an unexported `localKey` type (prevents collision with handler-set values). `Tenant(*Service)` resolves membership using the userID and stores the `*tenant.Ctx`. `TenantFrom(c)` is the package-level helper handlers use — panics if called on a route that wasn't through the chain (caught by Fiber's `recover` middleware).
- **`internal/http/handlers/me.go`** — `/v1/me` returns the resolved `{userId, tenantId, role}`.
- **`internal/http/server.go`** — Refactored to a `Deps` struct (Config + Verifier + Tenant) so subsequent tickets add subsystems by extending the struct. Critical detail: middleware is attached per-route, NOT via `v1.Use(...)`. Group-level Use would attach the chain to the whole `/v1/*` prefix including unmatched paths — a `GET /v1/typo` would return 401 instead of 404. Smoke-tested all five paths (ping=200, me no-auth=401, me bogus=401, /v1/typo=404, root=404).

Total: `go vet` clean, 16 tests pass across 9 packages, smoke test all 5 paths return the correct status, real Supabase + local Redis connect at boot.
