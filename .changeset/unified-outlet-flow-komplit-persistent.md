---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Unify additional-outlet flow + keep Komplit banner persistent for renewal.

Three pieces, one design correction:

- **Single "Tambah Outlet" button.** Replaces the per-module "Outlet Tambahan" buttons that were added in the prior commit. The old per-module model double-charged Komplit tenants — clicking POS card paid Rp 45k × months, then admin would click Inventory card and pay Rp 20k × months again, even though the Komplit Rp 45k rate already includes Inventory. The new button opens a sheet that asks **which package** the new outlet uses:

  - **Komplit (bundle)** — single charged POS row at the Komplit additional rate + paired Rp 0 Inventory row keeping both modules' billed counts in sync.
  - **POS only (kiosk)** — POS Toko à la carte additional rate.
  - **Inventory only (gudang)** — Inventory Toko à la carte additional rate.

  Options shown depend on what the tenant has active. Komplit users see all 3 options (full bundle, POS-only kiosk, gudang). Toko-only POS users see just the POS option. Each option's row shows its rate per month and a green "Hemat X%" pill mirroring the marketing language on the pricing page, computed from `(firstOutletPrice - additionalRate) / firstOutletPrice`.

- **Komplit banner persists post-purchase.** Was hiding via `if (isAlreadyKomplit) return null` so admin couldn't easily perpanjang from one place. Now stays visible with mode-aware copy: "Aktifkan Komplit" for non-Komplit, "Perpanjang Komplit" for active Komplit tenants. The expiry banner inside shows current Komplit expiry so the admin sees runway at a glance.

- **Server-side route logic.** `recordAdditionalOutletPayment` now accepts `packageKey` instead of `moduleKey`. For Komplit it writes two `financial_transactions` rows in one transaction (primary POS row charged the bundled rate, mirror Inventory row at Rp 0 with bumped billed count). For à la carte options it writes only the relevant module's row. `getAdditionalOutletContext` returns the available package options for the tenant so the sheet can render dynamically.

Math check: Mantra Maker on Komplit Annual adding a full-bundle outlet now correctly charges **Rp 45 000 × 12 = Rp 540 000** (18% cheaper than the Rp 660k first outlet — matching the pricing-page promise). Previous broken per-module flow was charging **Rp 65k × 12 = Rp 780k** (worse than the first outlet).
