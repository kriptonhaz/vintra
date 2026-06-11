---
"@vintra/web": patch
---

Fix: Komplit (and any) re-activation no longer overwrites `subscription_started_at`.

**Bug**: `recordPOSPaymentAndActivate` and `recordInventoryPaymentAndActivate` were setting `subscriptionStartedAt: periodStart` in BOTH the INSERT values AND the `onConflictDoUpdate` set clauses. For a Komplit activation where `periodStart` rolls over to a future date (e.g., the latest existing subscription expiry), the existing `subscription_started_at` got overwritten to that future date — corrupting the audit trail of "when did this tenant first activate this module?".

Concretely: a tenant who originally activated Inventory Toko on 2026-05-03 and then upgraded to Komplit on 2026-05-05 would have their inventory `subscription_started_at` rewritten to 2027-05-03 (the rolled-over `periodStart`).

The bug didn't break access — middleware checks `subscriptionExpiresAt`, not `started_at` — but it broke any UI/report that displays "anggota sejak X" or computes subscription tenure.

**Fix**: Both insert paths now use `now` (today) for `subscriptionStartedAt` on fresh INSERTs, and the `onConflictDoUpdate` set clauses **omit** `subscriptionStartedAt` entirely — so existing rows preserve their original first-activation date. Komplit/renewal payments only EXTEND the expiry, never reset the start.

Pattern matches what `recordPaymentAndActivate` (attendance) already does correctly via `currentSettings?.subscriptionStartedAt ?? now`.

**Data fix**: Patched Mantra Maker's existing subscription rows directly via SQL (the test tenant that triggered the discovery): inventory restored to 2026-05-03, attendance restored to 2026-04-30, POS set to 2026-05-05 (Komplit activation date). All other tenants are unaffected (this codepath only fires on Komplit activation, and Mantra Maker is the only tenant currently on Komplit).