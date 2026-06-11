---
"@vintra/web": patch
---

Fix `<input type="date">` (and time / datetime-local / month / week) overflowing on iOS Safari. WebKit's default styling for these inputs ignores our height/padding and centers the value via `::-webkit-date-and-time-value`, which pushed the date text out of view in narrow containers — visible on the attendance records filter and any other date-input screen. Global CSS now opts into our standard sizing + left-aligns the value pseudo-element. Other browsers unaffected.
