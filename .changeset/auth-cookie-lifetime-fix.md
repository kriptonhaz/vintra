---
"@vintra/web": patch
---

Fix premature logouts. The `sb-access-token` cookie was expiring after 1 hour (matching the JWT lifetime), so users who closed their tab and came back later were treated as logged-out — even though the long-lived `sb-refresh-token` cookie was still present and could have refreshed cleanly. Both cookies now share a 30-day lifetime; the server-side refresh fallback (already in place) handles expired JWTs by minting a new pair from the refresh token. Also adds the `Secure` flag in production (HTTPS) — kept JS-readable since Supabase JS reads/writes them.
