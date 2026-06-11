---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": minor
---

JUR-5: Lower Toko annual + ship Komplit bundle SKU + lift Inventory Free SKU cap.

**Pricing tweaks (visible immediately)**:
- POS Toko Annual lowered from Rp 65k/mo → **Rp 49k/mo** (Rp 588k/year). Savings label updated to 38% off vs monthly. Beats Qasir Pro Rp 700k by Rp 112k for tenants who only want POS.
- Inventory Free SKU cap lifted from 25 → **unlimited** (matches Qasir's free tier promise).

**Komplit bundle (the headline product)**:
- New POS tier `komplit` (added to `POSTierKey` + `pos_tier_chk` constraint via migration 0023).
- Two SKUs:
  - **Komplit Monthly**: Rp 75k/mo (1st outlet), +Rp 60k/mo per extra outlet
  - **Komplit Annual**: **Rp 55k/mo (Rp 660k/year)** + Rp 45k/mo per extra outlet — 27% off vs monthly
- Bundles POS + Inventory + Attendance + HPP at one flat price. `recordPOSPaymentAndActivate` detects Komplit plans and atomically:
  - Sets `pos_settings.tier = 'komplit'`, subscription active
  - Upserts `inventory_settings` to `'toko'` tier, subscription active (multi-unit, PO, alerts, HPP sync — same as standalone Inventory Toko)
  - Upserts `attendance_settings` with `subscriptionActive = true`, `billedStaffCount = 0` (sentinel — bundle includes unlimited staff; access middleware checks subscription only, not staff count)
  - Adds `pos`, `inventory`, `attendance` to `tenants.activeModules`
- `POS_KOMPLIT_FEATURES` declared as superset of `POS_BISNIS_FEATURES` — includes loyalty, promo codes, line discount, kitchen display, shift management. The "to-be-built" features (W2-W5) gate at the per-feature level and throw "Coming Soon"; Komplit subscribers get them automatically when each ships, no re-billing.
- Komplit gets `cashierCap: null` (unlimited), `branchCap: null`, `historyDays: null` — all the no-limit promises Qasir Pro makes.

**UI updates**:
- `/pos/billing` tier cards now show 4 tiers: Free / POS Toko / **Komplit (Populer)** / Bisnis. Komplit gets the green popular badge. New feature list explicitly calls out which Komplit features are still "Coming Soon" with asterisks (loyalty, promo, line discount, ingredient deduction, thermal printer).
- Landing page POS pricing tab same treatment — 4-card grid with Komplit as the highlighted bundle. New copy emphasises "lebih murah dari Qasir + tanpa komitmen 24 bulan + termasuk HPP gratis".
- Admin payment sheet (`pos-payment-sheet.tsx`) auto-includes Komplit in the plan picker dropdown via `POS_PLANS.filter(!comingSoon)`. Default selection is `pos_komplit_annual`. Plan label dropdown labels updated to clarify Toko = "POS-only" vs Komplit = "Bundle Semua Modul".
- Server-side plan label map (`PLAN_LABEL_ID`) in admin-finance.ts adds Komplit entries for receipt emails + billing UI.

**Tradeoff acknowledged**: Komplit subscribers immediately see "loyalty / promo / line discount / ingredient consumption / thermal printer" advertised on the bundle, but those features fire "Coming Soon" until W2-W5 ship. Documented on the billing page with a `*` asterisk legend. The trade vs delaying launch by 5 weeks: revenue starts now, early-adopter feedback shapes the parity-feature build.