---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

GPS capture errors now show a localized, browser-aware help string instead of the raw spec phrase "User denied Geolocation". Previously a cashier on iPhone Chrome with the iOS-level Chrome → Location set to "Saat Aktif" would still see the unhelpful message because the per-site permission inside the browser was separate — and nothing in the UI told them to go reset it. Three call sites benefit: `/attendance` clock-in (cashier flow) plus the two GPS capture buttons on `/master/branches` create + edit.

New `apps/web/src/lib/geolocation-error.ts` maps `GeolocationPositionError.code` to a friendly Indonesian/English message and appends a path-specific hint based on the userAgent (iOS Safari/Chrome/Firefox/Edge/Brave, Android Chrome/Samsung Internet/Firefox, desktop variants). Render targets switched to `whitespace-pre-line` so the multi-line steps wrap nicely. Error codes 2 (POSITION_UNAVAILABLE) and 3 (TIMEOUT) get their own short messages too — not just code-1 PERMISSION_DENIED.
