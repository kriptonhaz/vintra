---
"@vintra/web": minor
---

Role-aware mobile home dashboard. Home-screen widgets (sales chart, team attendance, total products, low stock, transactions, personal attendance) now render based on the signed-in role's permission keys instead of a binary owner/staff split: owners see a 2×2 metric grid, and an attendance-only staff member gets a dedicated "shift companion" layout (hero card with live worked-duration + today's shift + check-in/out, plus a month recap of their own attendance).

Supporting backend: the mobile API gateway gains attendance/sales/inventory overview and cashflow-today endpoints; `listMyTenants` now returns each tenant's resolved permission keys so the app can gate UI; and the home read endpoints (`getSalesSeries`, `getAttendanceTodayOverview`) enforce the matching permission server-side.
