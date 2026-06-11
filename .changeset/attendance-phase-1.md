---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add Phase 1 of the Attendance (Absensi) module: 4 new tables (branches, branch_schedules, staff_profiles, attendance_settings), `requireActiveModule` middleware, platform-admin activation flow from the tenant detail page (Rp 5.000/staff/month, manual activation until the payment gateway epic), owner pages for branch + staff CRUD with weekly schedule editor and "Use current location" button, attendance settings page (GPS/photo/QR mode picker + QR rotation), attendance dashboard with rollup stats, and a locked-state page for tenants without an active subscription. Sets MODULES.attendance price to 5000 and adds billingUnit flag.
