---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Hide the sidebar scrollbar. The nav still scrolls when its items overflow, but the always-visible gutter (from `overflow-y-auto`) was visually noisy and ate a few pixels of horizontal space. Added a `scrollbar-none` Tailwind utility (Firefox `scrollbar-width: none` + WebKit `::-webkit-scrollbar { display: none }`) and applied it to the sidebar nav.
