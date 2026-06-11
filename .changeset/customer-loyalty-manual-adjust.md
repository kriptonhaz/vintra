---
"@vintra/web": minor
---

Manual loyalty adjustments for paper-card migrations.

Both `adjustLoyaltyPoints` (pos.ts:3864) and `adjustStampCard` (loyalty-stamps.ts:875) already exist and write properly to the movement ledger, but there was no UI to call them — meaning a tenant migrating from a paper stamp card or notebook points ledger had no way to seed those balances except through the Qasir bulk import (which only seeds on NEW customers).

Adds a "Sesuaikan" button on `/master/customers/$customerId`:
- Loyalty Poin section header → opens a dialog scoped to the customer's points balance
- Each Kartu Stempel row → opens a dialog scoped to that one program

Shared `AdjustLoyaltyDialog` component:
- Tambah / Kurangi toggle (no signed input — merchants shouldn't have to think about minus signs)
- Positive-only amount input with live "tidak boleh lebih dari saldo saat ini" guard on Kurangi
- Required reason field (max 200 chars) — gets persisted on the movement row so the ledger keeps a real audit trail like "Migrasi dari kartu kertas Pak Budi"

Both dialogs hit the existing server fns which already enforce `pos.manage` permission + the Komplit `loyalty_points` feature gate; revoke paths refuse to drive the balance below zero.
