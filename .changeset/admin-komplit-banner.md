---
"@vintra/web": minor
---

Admin tenant page: one-click "Aktifkan Komplit" banner.

The admin tenant detail page had three separate per-module activation flows (POS / Inventory / Attendance), each with its own "Aktifkan" button. To bundle a tenant onto Komplit, admin had to know that selecting "Komplit (Bundle Semua Modul) — Tahunan" inside the POS plan dropdown would also activate Inventory + Attendance — non-obvious, and easy to mis-handle by activating each module separately (and double-billing the tenant).

**Added**: a prominent `KomplitBundleBanner` component that sits above the three per-module sections. Single CTA "Aktifkan Komplit" opens the existing POSPaymentSheet pre-selected to `pos_komplit_annual` — admin can submit immediately or switch to Monthly via the dropdown. The server-side `recordPOSPaymentAndActivate` already handles the multi-module activation (one financial_transaction row, all 3 module subscriptions flipped on, all 3 added to `tenants.activeModules` — landed in JUR-5).

Banner shows the included modules as chips (POS Toko / Inventory / Absensi unlimited staf / HPP gratis) so admin knows what they're activating. On success, all 3 module subscription queries are invalidated together so the per-module sections below reflect the new state without a manual refresh.

The banner hides itself when the tenant is already on a Komplit subscription — no upsell point. Per-module sections still render so admin can adjust expiry, deactivate, refund, or run trials individually if needed (each module's settings row exists either way).

**POSPaymentSheet** gained an optional `initialPlanKey` prop to support the pre-selection. Falls back to the existing default (POS Toko Annual) when not provided, so other call sites are unaffected.