---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Admin "Catat Pembayaran Outlet Tambahan" flow + tenant hard-block becomes capacity-aware.

When a tenant on a paid module wants to add a new branch, they get hard-blocked at `/master/branches` and routed to WhatsApp admin (prepaid model). What was missing: the admin didn't have a clean way to record the prorated payment for that extra outlet.

This adds:

- **New server fns** in `apps/web/src/server/functions/admin-finance.ts`:
  - `getAdditionalOutletContext` — returns the tenant's latest paid `planKey`, current `billedOutletCount`, and months remaining in the subscription period. Drives the sheet's live cost preview.
  - `recordAdditionalOutletPayment` — records a partial-window `financial_transactions` row (period: now → existing `periodEndAt`) with `billedOutletCount = previous + count`. Amount = `monthsRemaining × additionalRatePerMonth × count`. Does NOT extend the subscription — only covers the extra outlets for the remaining window.

- **New component** `apps/web/src/components/admin/finance/additional-outlet-sheet.tsx`:
  - Loads current paid state, shows "currently billed: N outlets · ~X months remaining"
  - Input for # outlets to add
  - Live prorated cost preview (rate × months × count)
  - Standard payment capture fields (transferDate, bankRef, proof, notes)
  - Tells admin the new billed count so they can confirm with the tenant

- **Admin tenant detail page** (`apps/web/src/routes/admin/tenants.$tenantId.tsx`): added "+ Outlet Tambahan" button next to "Perpanjang" on both POS and Inventory module cards (only shown when the module is paid+active).

- **Tenant hard-block** at `/master/branches` is now capacity-aware. Was: any paid-tier tenant with ≥1 branch got routed to WhatsApp admin for ANY add. Now: blocks only when actual branches with a paid module enabled exceed that module's billed outlet count. After admin records an outlet-tambahan payment, the block lifts automatically and the tenant creates their branch with their own GPS/address/module toggles — no admin guesswork.

Out of scope: Komplit-bundle auto-sync (POS-paid Komplit doesn't auto-bump Inventory billed count — admin clicks both module cards for a full-bundle outlet). Will tighten later if it becomes a friction point.
