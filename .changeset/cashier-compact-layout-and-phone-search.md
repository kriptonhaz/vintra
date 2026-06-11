---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Two cashier UX fixes:

- **Auto-collapse sidebar on `/pos/cashier`.** The cashier flow now hides the desktop fixed sidebar so the product grid + cart panel use the full screen width. The hamburger button stays visible (on every viewport) so the cashier can pop the sidebar open as a slide-in overlay anytime. Mirrors the Restro POS layout pattern.
- **Fix customer phone lookup.** The picker / list search did `ILIKE %<input>%` against the raw input (e.g. `08118492869`), but stored phones are canonicalised to `62...` form (`628118492869`) — so the leading `0` made every desktop-typed lookup miss. We now strip the leading `0`/`62` from the search input before the ILIKE so trailing-digit lookups hit regardless of which prefix the cashier types.
