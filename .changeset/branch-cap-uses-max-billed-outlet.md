---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

`/master/branches` cap reader now uses `MAX(billed_outlet_count)` across all paid `financial_transactions` rows per module instead of the latest row's value. There are two admin writers with different semantics — `recordAdditionalOutlet` writes cumulative outlet counts while `recordPOSPaymentAndActivate` writes the per-payment `outletCount` (defaulting to 1 on renewals) — so a renewal landing as `billed=1` would silently regress the cap on a tenant who had already paid for, say, 12 outlets via earlier outlet-tambahan rows. The page would then flip the "Tambah Cabang" button to the locked "Tambah Cabang via Admin" CTA even though the tenant was within their paid capacity. `planKey` is still taken from the latest paid row (it represents the current plan for the cost-preview rate). MAX is robust to whichever writer ran last and matches the "highest outlet count this tenant has ever paid for" semantic the cap is meant to enforce.
