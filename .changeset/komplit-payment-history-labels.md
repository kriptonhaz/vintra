---
"@vintra/web": patch
---

Fix: payment history labels for Komplit + Inventory + per-row suffix.

Three issues in the Riwayat Pembayaran table on `/admin/tenants/$id`:

1. **Modul column showed "POS" for Komplit rows.** Even though the row's `module_key` is `'pos'` (Komplit is administered through the POS payment flow), the actual scope is POS + Inventory + Absensi. Misleading. Now shows "**Komplit (Bundle)**" when the plan key starts with `pos_komplit_`.
2. **Plan column showed raw plan keys** like `pos_komplit_annual` and `inventory_toko_annual` because the local `PLAN_LABEL` map only had attendance entries. Expanded the map to cover all current POS + Inventory plans. Now shows "**Komplit · Tahunan**", "**Toko · Bulanan**", etc.
3. **"0 staf" suffix appeared on every row** because the condition was just `billedStaffCount != null`. Komplit rows always send `billedStaffCount: 0` (per-staff billing skipped — bundle includes unlimited staff), so the suffix incorrectly read "0 staf" for Komplit rows. Fixed: staff suffix only shows when `moduleKey === 'attendance' && billedStaffCount > 0`. New: Komplit rows show "{N} outlet" suffix from `billedOutletCount` instead.

Also wired `billedOutletCount` through the API surface (`listTransactions` select clause + `TransactionRow` interface + 3 mapping call sites in admin/finance.tsx + admin/tenants.$tenantId.tsx + attendance/billing.tsx). Same Komplit-aware label + plan map applied to `TransactionDetailDrawer` so clicking the row shows the same friendly labels.