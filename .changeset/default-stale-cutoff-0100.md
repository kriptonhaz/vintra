---
"@vintra/web": patch
"@vintra/db": minor
"@vintra/shared": patch
---

POS Peti Kas: default every tenant's stale cash-session rule to a 01:00
WIB daily cutoff (#216 follow-up).

Following the configurable-threshold change, the default is now a
business-day cutoff at 01:00 instead of the elapsed `14h` window. A
session opened during the day is only flagged for force-close once the
clock passes 01:00 WIB — so the prompt no longer trips at normal closing
time for late-evening outlets.

Migration `0125_default_cash_stale_cutoff_0100` flips the
`pos_settings.cash_stale_config` column default and migrates every
existing tenant to the cutoff. `DEFAULT_CASH_STALE_CONFIG` and the
settings-page fallback are updated to match. Tenants (and branches) can
still switch back to `elapsed_hours` in POS settings.
