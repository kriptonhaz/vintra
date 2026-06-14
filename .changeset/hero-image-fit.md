---
"@vintra/web": patch
---

Hero section: add a "Penyesuaian foto" option for the "Foto besar" layout. "Penuh, dipotong" keeps the existing background-crop behavior; "Tampilkan utuh (banner)" shows the whole image (16:9, object-contain on a neutral backdrop) without cropping — for pre-made banners that already contain their own copy. Any heading/address/CTA still overlays centered. Defaults to "dipotong" so existing heros are unchanged.
