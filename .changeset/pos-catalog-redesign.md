---
"@vintra/web": minor
---

Redesign the mobile Kasir (POS) catalog screen.

- **Product photos now render.** `listPOSProducts` pre-signs a short-lived `photoUrl` per product (same private-S3 + signed-URL pattern as inventory/attendance); the grid renders it with a placeholder fallback. Previously the screen only ever showed a placeholder icon.
- **Fixed the odd-last-item bug** — product tiles use a fixed half-width instead of `flex:1`, so a lone trailing item stays a half-width tile instead of stretching full width.
- **Infinite-scroll pagination** — the catalog loads 20 per page and fetches the next page on scroll-end.
- **Safe-area header** — added a `SafeAreaProvider` at the app root and the header now pads by the real top inset, so it's no longer tucked under the status bar.
- **Layout refresh on the design system** — rounded search pill, category chips, 2-column cards (photo + name + stock + price + inline qty stepper), and a floating cart bar (item count + total + Bayar). Cart sheet restyled to match.
