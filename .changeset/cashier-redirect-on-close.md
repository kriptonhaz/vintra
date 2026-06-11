---
"@vintra/web": patch
---

Redirect to the POS dashboard after closing the till.

Closing a Peti Kas session used to leave the cashier on `/pos/cashier`, where the absence of an open session immediately re-triggered the blocking Buka Kas modal — making it look like the close didn't take. The cashier now navigates to `/pos` after a successful close.
