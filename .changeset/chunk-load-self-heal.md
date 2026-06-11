---
"@vintra/web": patch
---

Self-heal stale-chunk failures after a deploy.

The root route now listens for Vite's `vite:preloadError` event — fired when a lazily-loaded JS chunk 404s because a deploy replaced the content-hashed filenames. It triggers a one-time (rate-limited) `window.location.reload()` so a tab left open across a deploy recovers automatically instead of showing a blank page. Paired with the nginx change serving the HTML shell as `Cache-Control: no-cache`, this removes the need to manually clear the browser cache after a deploy.
