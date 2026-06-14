---
"@vintra/web": patch
---

Hero + storefront preview polish: add a "Tinggi hero" control (Otomatis / 40 / 55 / 70 / 90 / 100 vh) for the "Foto besar" layout so banners can sit at a comfortable height regardless of screen width (works alongside the cover/full fit option). Also fix storefront product photos appearing blank in the Situs editor's live preview — the scaled preview frame stops lazy-load from firing, so product images now load eagerly in the editor (lazy stays on the live site).
