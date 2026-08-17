---
"@vintra/web": patch
---

Add a "Web typecheck" CI workflow so `apps/web` type errors are caught on PRs
and on `main`. CI previously ran only `changeset-check` and `mobile-typecheck`,
which is how two `tsc` errors sat undetected in `main`.

The job builds before typechecking, which is required rather than redundant:
`apps/web/src/routeTree.gen.ts` is gitignored, so a fresh checkout does not have
it and `tsc` would otherwise fail on every route file. The tanstackStart vite
plugin regenerates it during the build, and that is the only generator
guaranteed to match what dev and `./deploy.sh` produce — driving
`@tanstack/router-generator` directly would couple CI to its internal API.
Building also catches build regressions, which nothing in CI covered before
(`deploy.sh` builds locally).

Verified against a clean-room clone with no `.env` and no generated route tree:
install 2.5s, build 17.8s, typecheck 12.2s, all green.
