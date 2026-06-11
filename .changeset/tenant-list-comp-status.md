---
"@vintra/web": patch
---

Tenant list: distinct "Akses Gratis" status for comped tenants (JUR-194 follow-up).

A comp grant activates a module's subscription, which made the tenant list show "Berbayar" — misleading, since the tenant never paid. The list now derives a fourth status, `comp`, shown as a violet "Akses Gratis" badge, for tenants whose access comes from an applied, unexpired comp grant. Checked before "Berbayar" so a comped tenant is never mislabelled as paying.
