---
"@vintra/web": patch
---

Restart PM2 through the ecosystem file, not by app name.

`pm2 restart <name>` replays the config PM2 stored in its own dump when the app was
first started and ignores `ecosystem.config.cjs` entirely. A change to
`interpreter_args`, `max_memory_restart` or `env` therefore rsynced to the server,
showed up in git, and silently never took effect — including on the rollback path.

Passing the file — by absolute path through the release symlink, so it re-resolves
after a rollback moves it — makes the deployed config the live one. The rollback path
re-enters the symlink first: `cd` had already resolved it to an inode, so without
that the shell is still sitting inside the release being backed out of.
