---
"@vintra/web": patch
---

Hide "Situs" sidebar entry from roles without `booking.write` (staff, cashier). The route already redirected them to `/dashboard`, but the menu still showed — misleading. Adding `site: 'booking.write'` to the sidebar's module-permission map aligns visibility with route auth.
