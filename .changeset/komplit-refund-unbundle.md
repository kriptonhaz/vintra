---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix Komplit refund asymmetry — refunding a POS Komplit purchase now correctly deactivates the bundled Inventory + Attendance modules too.

The Komplit activation path (`recordPOSPaymentAndActivate`) atomically activates POS + Inventory + Attendance, but the refund path (`recordRefund` with `endSubscriptionNow=true`) was only flipping the original transaction's module off. That left tenants with active Inventory + Attendance subscriptions long after their Komplit purchase was refunded.

Detection: any refund where `moduleKey === 'pos'` AND the original plan's POS tier is `'komplit'` now cascades the deactivation to all three `*_settings` tables and removes all three keys from `tenants.activeModules` in the same transaction. Standalone POS Toko / Inventory / Attendance refunds are unchanged — they keep the single-module deactivation.

WhatsApp subscriptions are intentionally excluded from the bundle on both sides (activation never touches them, and refunds of Komplit don't disturb them).
