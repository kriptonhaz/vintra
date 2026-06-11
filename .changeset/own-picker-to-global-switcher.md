---
"@vintra/web": patch
---

Consistency: the five pages that had their own in-page branch dropdown — stock opname (`/inventory/movements/adjust`), cash sessions (`/pos/cash-sessions`), attendance records (`/attendance/records`), shift schedules (`/attendance/shifts`), and QR host (`/attendance/qr-host`) — now read the branch from the global topbar switcher instead. The redundant local picker is removed so there's a single source of truth for "which branch am I operating".
