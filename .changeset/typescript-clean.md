---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Bring `bun tsc` to zero errors and stop emitting `.js`/`.d.ts` artifacts.

**Root causes & fixes**
- Aligned `drizzle-orm` to `^0.45.1` in `apps/web` (was pinned to `^0.38.0`, which forced a second drizzle copy under `apps/web/node_modules`). The duplicate install made TS treat every drizzle expression as two unrelated types and accounted for ~1000 of the 1104 errors.
- Set `noEmit: true` in `tooling/typescript/tsconfig.base.json` and dropped `declaration` / `declarationMap` / `sourceMap`. Vite owns the build; tsc is type-check-only now, so running `tsc` no longer leaks `.js` / `.js.map` / `.d.ts` files alongside source.
- Typed the two `jsonb` columns (`notifications.data`, `platformAdminAuditLogs.metadata`) so TanStack Start's server-fn serialization narrowing accepts them.
- Fixed the `noUncheckedIndexedAccess`-incompatible `const [{ count }] = await db.select(...)` pattern across 7 server-fn files.
- Misc: missing imports (`ilike`, `ResolvedSchedule`), removed obsolete `tanstackStart({ target: 'node-server' })` config, `proofKey` → `proofPhotoKey` field name fix, removed `.default(0)` on inventory item `costPrice` (incompatible with RHF's Resolver typing — defaults now come via `defaultValues`), nullish guards on i18n `t()` and form field-state messages, BufferSource cast for WebPush.

**New script**
- `bun run typecheck` (root) → `tsc --noEmit` in `apps/web`. Use it to verify type safety without spawning compiler output.
