---
"@vintra/web": patch
---

Comp grants — pick multiple modules in one request (JUR-194 follow-up).

The "Beri Akses Gratis" form now uses checkboxes: tick any combination of POS / Inventory / Absensi / WhatsApp, each with its own tier, and comp them all in a single submit instead of one module at a time. Picking POS at the Komplit tier auto-disables the Inventory and Absensi checkboxes ("sudah termasuk paket Komplit") so you don't create overlapping grants.
