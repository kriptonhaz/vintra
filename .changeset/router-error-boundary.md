---
"@vintra/web": patch
---

Show an error message instead of a white screen when a page fails to render.

TanStack wraps a route in a catch boundary only when an error component is
configured — `Match.js` resolves the boundary to a plain fragment otherwise —
and the router defined none. Any render error therefore escaped to the React
root and unmounted the whole app. What reached the console was React's own
teardown failure, `Failed to execute 'removeChild' on 'Node'`, which describes
the collapse rather than its cause, so the original error was never visible.

`defaultErrorComponent` now installs the boundary and `defaultOnCatch` logs the
real error. A failing page keeps the rest of the app mounted, states what went
wrong, and offers retry / reload / back-to-dashboard, with the stack behind a
disclosure — enough for a merchant's screenshot to be actionable.

A test asserts the wiring, because the failure mode was that nobody had
configured it and nothing failed loudly enough to notice.
