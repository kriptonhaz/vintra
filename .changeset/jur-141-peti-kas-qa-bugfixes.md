---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-141 Peti Kas — fix two regressions caught during local QA before deploy:

**Client-bundle leak ("Buffer is not defined")**
The shared helpers (`insertCashMovement`, `findOpenSession`, `CASH_DRAWER_OPEN_FIRST`) were exported as plain functions/constants from `apps/web/src/server/functions/pos-cash.ts`. The TanStack Start macro only strips `createServerFn().handler(...)` bodies from the client bundle — non-createServerFn exports stay and transitively pull in `db` → `postgres` → Node Buffer, crashing `/pos/cashier` + `/pos/cash-sessions` in the browser. Moved the helpers into a new server-only `apps/web/src/server/lib/cash-movement.ts` so routes never import them.

**`insertCashMovement` silently dropped the running-total update**
`tx.update(posCashSessions).set({ [direction]: sql.raw(...) })` used the SQL column name (`'cash_in_total'`) as the key. Drizzle's `.set()` expects the schema property name (`cashInTotal`) and silently ignored the unknown key, so the ledger row was inserted but `cash_in_total` / `cash_out_total` never incremented — the cashier chip showed stale balances after every sale/setor/tarik. Split into explicit sale vs non-sale branches using `posCashSessions.cashInTotal` / `.cashOutTotal` column refs.

**Hooks-order violation in `/pos/cashier`**
Banner-dismiss `useState` + `useEffect` were declared after the `if (masters.isLoading) return ...` early returns. React detected hook count changes between renders and force-crashed the component. Moved the hooks up to live with the rest of the state declarations.

No DB migration. No schema change. All three bugs would have shipped to prod if we hadn't run the local end-to-end test.
