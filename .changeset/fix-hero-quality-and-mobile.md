---
"@vintra/web": patch
---

Site editor image fixes: (1) Hero/gallery/about photos are no longer blurry — they now compress at a much higher resolution (~1600–1920px) with adaptive JPEG quality (steps quality down to fit the size budget instead of blanket-downscaling to 800px), and the site-asset size cap was raised to 1.5 MB. (2) The hero banner no longer over-crops on mobile — a fixed-height hero now falls back to the image's 16:9 ratio below the `sm` breakpoint so the whole banner shows like a normal carousel, while keeping the configured fixed height on tablet/desktop.
