---
"@vintra/web": patch
---

Deploy the web app as immutable releases behind a symlink instead of
overwriting the live tree.

`./deploy.sh web` used to rsync into `~/prod/Vintra` and `rm -rf node_modules`
while both PM2 instances were still serving. The build splits routes into
hash-named chunks the server imports lazily, so overwriting the tree removes
chunks the running processes have not loaded yet — the next request for that
route dies with `ERR_MODULE_NOT_FOUND` until the rolling restart reaches that
instance. Wiping `node_modules` mid-flight does the same to any dependency not
yet required. This hit JuraganQu in production on 2026-08-17, a ~20-second
window per deploy; Vintra ran the identical script.

Each deploy now writes `~/prod/Vintra-releases/<utc>-<sha>/`, installs its own
`node_modules` there, and cuts over with a single atomic rename. Node resolves
module paths to their realpath, so a process started before the swap keeps
loading from its own release until it is restarted — nothing under a running
process ever changes. A failed health check rolls the symlink back and
restarts. Old releases are pruned only after both instances are on the new one,
keeping 3 for rollback.

`.env` moves to `~/prod/Vintra-shared/.env` and is symlinked into every
release, so the documented "edit `~/prod/Vintra/.env`" flow still lands on the
same file and now survives deploys. The first deploy copies the existing file
there automatically.

Ported from JuraganQu (6fdf298), with one fix on top: that version leaves
`~/prod/Vintra` non-existent for the ~30-60s between retiring the old tree and
the cutover, so a PM2 autorestart landing in that window could not resolve its
recorded cwd. The symlink is now re-pointed at the retired tree immediately, so
the path stays valid throughout.
