---
"@vintra/web": patch
---

Mobile sidebar now auto-closes when a nav item is tapped, instead of staying open and forcing the user to dismiss it via the backdrop. Applied to both the tenant sidebar and the admin sidebar — every nav link, the admin-panel link, the user-profile link, and the back-to-dashboard link. Desktop sidebars are unaffected (they're a separate always-visible aside).
