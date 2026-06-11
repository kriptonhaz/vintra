---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Tenant "Tambah Cabang" sheet now short-circuits when admin already recorded the outlet-tambahan payment.

Before: even after admin recorded the prepaid payment in the admin panel, the tenant's create sheet still showed the module toggles, the live cost-preview ("+ Rp 45.000/bulan"), and the orange "Pembayaran upfront · Hubungi admin via WhatsApp" notice — all wrong, because the money is already settled.

Now: when the tenant has unused billed capacity (`posBilledOutletCount > pos count` OR `inventoryBilledOutletCount > inventory count`), the sheet renders a "Sudah Dibayar · Outlet siap dibuat" green notice with module badges showing exactly what the admin paid for, then drops straight into the branch-detail fields (name / address / GPS / radius / isMain). The pre-filled `enabledModules` come from the unused-slot computation: POS+Inventory+Attendance for paired Komplit slots, just POS for a POS-only kiosk slot, just Inventory for a gudang slot.

No behaviour change when the tenant has NO unused capacity — the original module-toggle + cost-preview + WhatsApp-prepaid flow still fires for first-time setup or for opportunistic "I want to add another outlet" attempts that haven't been pre-paid yet.
