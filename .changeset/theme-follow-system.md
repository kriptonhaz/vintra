---
"@vintra/web": patch
---

Theme defaults to the OS `prefers-color-scheme` instead of always starting in light mode. The first explicit toggle persists to localStorage and stops following the system, so a user's manual choice sticks until they toggle again.
