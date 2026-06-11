---
"@vintra/web": minor
"@vintra/db": minor
---

Franchise / Independent — Phase C. HQ can now set a per-item **franchise price** in the item editor (`inventory_items.franchise_price`). When a **franchise** branch raises a stock requisition, each line is priced from that franchise price and stored on `stock_requisition_items.unit_price` (migration `0096`); ordering an item with no franchise price is rejected. An **independent** branch's requisition stays a plain transfer — `unit_price` null. The requisition detail page shows the per-line price, subtotal, and a "Total Pembelian dari Pusat".

Deferred to a follow-up: posting the requisition's cashflow entries on fulfillment (an expense on the franchise branch + income on HQ). That needs cashflow category/account resolution and a new `cashflow_entries.source` value — intentionally not rushed.
