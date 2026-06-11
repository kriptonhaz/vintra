---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add platform admin foundation: `platform_admins` table, `requirePlatformAdmin` middleware, `/admin` route area (tenant list, tenant detail, platform-admin management), and conditional "Panel Admin" link in the user sidebar. Bootstrap the first admin via Supabase SQL editor; subsequent admins are added through the `/admin/platform-admins` UI.
