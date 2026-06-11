---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Document the JUR-185 subdomain nginx pitfall: if
`sites-enabled/public-tenant` is a regular file rather than a symlink
to `sites-available/`, edits to `sites-available/` silently fail to
take effect on reload. Symptom on subdomain: SSR works but the
client-side server-fn `POST /_serverFn/<hash>` returns 500
`{"error":"Only HTML requests are supported here"}` because a stale
`rewrite ^(.+)$ /q/$sub$1 break;` is still rewriting the path before
it reaches Node. Adds an explicit symlink-check step to
SUBDOMAIN-DEPLOY.md and a troubleshooting row with the exact fix.
