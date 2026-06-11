---
"@vintra/web": patch
---

Fix: the inventory stock-movement history (`/inventory/movements`) now follows the topbar branch switcher. It was loaded once tenant-wide and ignored the selected branch — switching outlets left the list showing the previous branch's data. The list is now fetched per selected branch and re-fetches on switch.
