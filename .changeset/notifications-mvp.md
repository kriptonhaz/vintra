---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add a notifications system covering in-app bell-icon delivery and native browser push (Web Push API + service worker). Sources: trial granted/expiring/expired, payment received/refunded, subscription expiring 7d/1d, clock-in/clock-out reminders (tenant-wide config in /attendance/settings — N minutes before OR after the scheduled time), and an admin broadcast page at /admin/notifications targeting all tenants, specific tenants, by role, or by module subscription. Uses an in-process node-cron tick (no separate worker) with idempotent inserts via a partial unique index on (user_id, type, source_key).
