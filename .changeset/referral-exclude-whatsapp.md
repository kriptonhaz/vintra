---
"@vintra/web": minor
---

Scope the referral discount to core modules — exclude WhatsApp AI (JUR-193).

The referral discount is a customer-acquisition incentive; it now applies only to the core packages (POS, Inventory, Attendance / Komplit), not the WhatsApp AI add-on.

- `recordWaPayment` records a WhatsApp payment at full price — no referral discount applied, no referral commission credited.
- The WhatsApp payment sheets (the shared admin sheet and the inline one on the finance screen) no longer show a referral discount banner or discounted total.
- The tenant referral page now states clearly that the discount covers the main packages only and excludes add-on modules like WhatsApp AI; the admin tenant-detail referral banner notes the same.
- POS / Inventory / Attendance referral discounts are unchanged.
