---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Two connected fixes to /settings/roles:

1. **Global Kasir role now grants `pos.read`.** Cashiers can read `/pos/sales` (transaction history) by default — owners regularly need their cashiers to look up past sales for reprints, refunds, and customer questions. Margin/profit on `/pos/reports` stays gated on `pos.report.profit`, so cashiers gain history visibility without seeing untung kotor / margin.
2. **UI editability filter now matches the server's.** Globally seeded roles (Kasir / Supervisor / Staff) carry `is_system=false` but `tenant_id=null`. The server's `loadEditableRole` already rejects mutations on them ("Peran bawaan sistem tidak bisa diubah"), but the UI used to bucket them as "Peran kustom" because it only checked `!isSystem`. Saves silently appeared to revert. The filter now requires `!isSystem && tenantId !== null` for the editable section; globally seeded roles join the readonly "Peran bawaan sistem" group where they belong. To customize them per tenant, owners create a new role from scratch (existing templates picker already covers the common cases).

Prod: the existing global `cashier` row was patched directly to grant `pos.read` (idempotent INSERT into `role_permissions`) plus the description was refreshed to "Membuat transaksi POS dan melihat riwayat penjualannya." Both because the `seed:rbac` script still has the unrelated `ON CONFLICT` constraint issue that prevents a full re-run.
