---
"@vintra/web": minor
---

Wire the attendance, POS, and booking modules to the global branch switcher.

The attendance dashboard (today's counts, 7-day chart, top-late) and the POS dashboard (today's sales, recent sales, top items) now scope to the selected branch. The POS cashier seeds its branch from the global selection and syncs its own picker back to it. The booking calendar drops its per-page branch picker in favour of the shared topbar switcher.
