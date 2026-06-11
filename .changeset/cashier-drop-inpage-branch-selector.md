---
"@vintra/web": patch
---

Drop the duplicate branch selector from the Kasir.

The Kasir header used to render its own branch selector above the search bar, duplicating the global topbar dropdown. Removed it — the global topbar is now the only control, and the cashier follows it (the previous "sticky after first load" behavior existed mainly so a topbar change wouldn't clobber an in-progress sale via the local selector, which no longer exists).
