---
"@vintra/web": patch
---

Removes the **Aktif** / **Trial** / **Pro** badges from the sidebar nav rows. They were largely cosmetic — tenants on a paid module saw "Aktif" forever, trial countdown was redundant with the in-page trial banner, and the Pro upsell still surfaces when a gated module is clicked. The leaner sidebar reads cleaner on mobile and trims a small slice of computed-per-render state.

Also drops the supporting helper (`moduleStatusFor`) plus the four subscription locals it was the only consumer of (`attendanceSub`, `inventorySub`, `posSub` — `waSub` stays because the feature-set assembly still reads it).
