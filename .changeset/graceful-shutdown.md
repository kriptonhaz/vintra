---
"@vintra/web": patch
---

Graceful shutdown on deploy to eliminate deploy-window Cloudflare 520s.

`server-entry.mjs` now handles SIGINT/SIGTERM by closing the HTTP server, dropping idle keep-alive sockets, and draining in-flight requests before exiting (with an 8s force-exit safety net). PM2's `kill_timeout` is raised to 10s so the drain completes before SIGKILL. Previously a deploy hard-killed each instance mid-response, severing in-flight requests into empty replies that surfaced as Cloudflare 520s.
