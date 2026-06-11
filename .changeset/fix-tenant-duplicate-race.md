---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix tenant-duplicate-on-signup race + non-deterministic membership pick.

Two production owners ended up with 3 tenants each, all created
within ~30ms — classic signature of two concurrent signup requests
both passing a "does this user already have a tenant?" check before
either INSERT lands. One of the duplicates had a paid Komplit
subscription that the user couldn't always reach because
`requireAuth`'s `limit(1)` membership pick had no `ORDER BY` —
Postgres returned whichever physical row it hit first, so the same
user randomly landed on different tenants between requests (which is
how the customer saw extra modules in one session and not the next).

Three-layer fix:

- **`apps/web/src/server/middleware/auth.ts`** — membership query
  now `ORDER BY tenant_members.created_at ASC`. Pins to the oldest
  membership (matches "your original account" intuition); stable
  even if dupes ever sneak through.
- **`apps/web/src/server/functions/auth.ts`** — `registerWithEmail`
  pre-checks `tenants.owner_id` and returns the existing tenant
  shape on re-submit. `ensureTenantForOAuth` catches Postgres
  unique-violation (23505) and returns `{ created: false }` instead
  of bubbling a 500 to the OAuth landing page.
- **migration 0069** — `UNIQUE(tenants.owner_id)` constraint.
  Defense in depth: even if app-level checks ever miss, the DB
  rejects the second INSERT. Applied directly to prod (was safe
  because the only 2 affected owners had been manually cleaned to
  a single tenant each beforehand).

Multi-tenant-per-user support (legitimately running multiple
businesses from one account) is filed as Linear JUR-186 — when that
ships, this constraint gets dropped and replaced with a
session-level tenant picker.
