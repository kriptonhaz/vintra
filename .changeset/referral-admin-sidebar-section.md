---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Give the admin referral pages their own sidebar section.

The referral admin pages were split between a "Modul" section (config, claims) and no entry at all (the new access audit page). They now live under a dedicated "Referral" section — Akses, Klaim, Konfigurasi — so the access allowlist page is discoverable.

The global config page is also reframed: now that caps are per-tenant, its `capPct` field is relabelled as the default cap pre-filled when enabling a new tenant (not a globally enforced limit), and the stale "lowering the cap" warning is removed since lowering a new-tenant default has no retroactive effect.
