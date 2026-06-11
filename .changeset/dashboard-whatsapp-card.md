---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add WhatsApp AI module card to the owner dashboard grid. Previously the dashboard listed HPP, POS, Inventory, and Attendance but not WhatsApp — so tenants who'd activated it had no entry point from the dashboard. Badge reads "Aktif" when `moduleSubscriptions.whatsapp.active` is true, "Add-on" otherwise (matches pricing-page nomenclature).
