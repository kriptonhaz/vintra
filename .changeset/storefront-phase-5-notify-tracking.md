---
"@vintra/web": minor
---

Toko Online (storefront) — Phase 5: notifications & order tracking. Adds a public `trackOrder` (lookup by order number + WhatsApp phone) with a "Lacak Pesanan" modal in the storefront section showing live status, items, and resi. Adds best-effort admin auto-notification on checkout: when the tenant configures an "auto-notify" WhatsApp instance, `placeOrder` posts to a new Go API internal endpoint (`POST /v1/internal/wa/notify`, authed via INTERNAL_SERVICE_TOKEN) that messages the instance's admin phone — degrading silently to the customer wa.me deep link when not configured. Requires deploying the API for the integrated path to activate.
