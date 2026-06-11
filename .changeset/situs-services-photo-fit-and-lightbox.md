---
"@vintra/web": patch
---

Situs "Layanan & Harga" — product photos now fit the card frame without cropping (`object-contain` against a neutral background), so a tall portrait shot no longer loses its top and bottom to fill a landscape frame. The card frame itself stays a fixed 4:3 so the grid still lines up; gaps between the photo and the frame are filled with a soft gray.

Clicking a photo opens a fullscreen lightbox modal (backdrop click + ESC to close, body scroll locked while open), mirroring the studio gallery pattern, so visitors can see the photo at full size with the item name beneath. List view's small thumbnail keeps its existing `object-cover` because letterboxing a 48 px thumbnail looks worse than a tasteful crop.
