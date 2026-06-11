---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix WhatsApp module permissions and dashboard error states (JUR-84):

- Add dedicated `whatsapp.read` and `whatsapp.manage` permissions, seeded
  for owner/admin (both) and supervisor (read only). Staff and cashier no
  longer see the WhatsApp section in the sidebar.
- Replace the placeholder `requirePOSAccess()` gate on all WhatsApp
  server functions with `requireWAAccess()` / `requireWAManageAccess()`
  so reads and mutations are properly scoped to the right roles.
- Rewrite the WhatsApp dashboard loader to distinguish three failure
  modes — forbidden, api error, and no plan — instead of collapsing all
  three into the misleading "Belum ada paket aktif" message that showed
  up even for tenants with an active subscription.
