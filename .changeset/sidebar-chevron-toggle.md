---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Sidebar: chevron toggles expand without navigating.

Original tree behaviour required navigating to a module just to see its children — bad on mobile, where opening "Pengaturan" inside Absensi meant tapping Absensi (loads dashboard), waiting for the route to change, then tapping the now-revealed child. Two unnecessary roundtrips per quick lookup.

Split the row into two click targets: the icon + label still navigates to the module home, the chevron toggles expand only. Cashier can now peek at any module's sub-pages from anywhere without leaving the current page. Active module stays auto-expanded on URL match (no behaviour change there); manual chevron toggles persist within the session.
