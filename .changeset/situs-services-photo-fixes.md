---
"@vintra/web": patch
---

Situs "Layanan & Harga" photo polish:

- Card photos now explicitly round their top corners (`rounded-t-2xl`) so they follow the card frame on every browser. The outer `overflow-hidden` alone didn't always clip the photo's letterbox background cleanly.
- Bumped the photo lightbox z-index from `60` to `1000` so the Maps section (Leaflet uses up to z-index 800 for its panes and zoom controls) no longer bleeds over the bottom of the modal.
- List view's 48 px thumbnail is now also clickable (opens the same lightbox) and uses `object-contain` to match the grid, so a tall product photo isn't aggressively cropped in the thumb either.
