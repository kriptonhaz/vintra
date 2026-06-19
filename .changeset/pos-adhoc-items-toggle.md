---
"@vintra/web": minor
"@vintra/db": minor
---

Add a per-tenant "Item Lain" (ad-hoc cashier line) toggle to POS settings as an anti-fraud control. Ad-hoc lines carry no product/inventory link and are hard to audit, so the button is now off by default and a tenant opts in. The toggle is ungated — reachable on every tier including free, even though the rest of POS settings is Toko+ — so no tenant is trapped without a way to re-enable it. The cashier hides the button when off, and `createSale` rejects ad-hoc lines server-side so a stale tab or crafted payload can't bypass the setting.
