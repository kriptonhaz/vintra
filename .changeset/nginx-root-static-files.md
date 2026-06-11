---
"@vintra/web": patch
---

Fix /favicon.png 404 in production. The nginx reverse-proxy config only had a route for /favicon.ico, so requests for the PNG favicon were proxied to Node (which doesn't serve root static files) and returned 404. Added explicit nginx locations for /favicon.png and /sw.js (the Web Push service worker, which had the same problem). The service-worker location also gets a no-cache header so clients pick up SW updates immediately.
