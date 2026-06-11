---
"@vintra/web": patch
---

Two Konten polish fixes. Image downloads now work on iOS — the page prefers the Web Share API (so iOS gets a native "Save to Photos" sheet) and falls back to `<a download>` on desktop and Android. The gallery lightbox before/after thumbnails are now real buttons: clicking either swaps the big image, with a brand-highlighted border showing which is active.
