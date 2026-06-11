---
"@vintra/web": patch
---

Fix: the situs hero CTA no longer overlaps the location text. Both the location pill and the CTA button were `inline-flex` (inline-level), so the CTA's `mt-*` couldn't push it onto a new line — they tried to share a single inline flow. Wrap each in a block `<div>` (which now carries the `mt-*`) so the location and CTA each sit on their own row. Applies to all three hero layouts (`image-bg`, `split`, `color-bg`).
