---
"@vintra/web": patch
---

Exclude comp grants (Rp 0 free-access activations) from the admin dashboard MRR estimate and paid-module tally. A comped subscription sets the same `subscription_active`/expiry columns as a paid one, so the dashboard was counting free grants as revenue — a `komplit` POS comp alone inflated MRR by ~Rp 5 jt via its bundled 999-seat Attendance. The dashboard now subtracts tenants with an active applied comp grant (expanding a `komplit` POS comp into its bundled Inventory + Attendance) before computing both cards.
