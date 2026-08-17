---
"@vintra/web": patch
---

Run `bun test` for `apps/web` in CI, and add the `test` script that makes it
runnable (`bun run test` from the repo root).

One test file already existed but nothing ever executed it. The Web typecheck
workflow now runs the suite after typechecking, with `if: always()` so a type
error cannot hide a failing test.
